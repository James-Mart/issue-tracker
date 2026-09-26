import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { conversationsDir } from "../config.js";
import {
  clearRunLiveMarker,
  writeRunLiveMarker,
} from "./run-live.js";
import {
  agentSdk,
  CursorAgentError,
  type AgentHandle,
  type AgentImage,
  type AgentRun,
  type AgentRunResult,
  type AgentSdk,
  type AgentSteerOutcome,
} from "./agent-sdk.js";
import {
  classifyAgentFailure,
  isAuthFailureEvent,
} from "./agent-failure.js";
import { evictConversationStoreCaches } from "./agent-state-caches.js";
import {
  appendEvent,
  assembleAgentPrompt,
  listConversationIds,
  readConversation,
  setPendingMessage,
  updateMeta,
} from "./conversations.js";
import {
  cancelConversationDelegations,
  createDelegateCustomTools,
} from "./delegate-tool.js";
import { clearCatchupBuffer, publishFrame } from "./conversation-stream.js";
import { ISSUES_TOPIC } from "./issue-events.js";
import { publishPipelineRunEvent } from "./pipeline-runs-events.js";
import {
  EventPipeline,
  type NormalizedStep,
} from "./event-pipeline.js";
import { stopAgentStack } from "./agent-stack.js";
import { resolveConversationModel } from "./model-selection.js";
import { requireProjectWorkspace } from "./project-workspace.js";
import { reconcileOrphanedConversation } from "./orphan-run-scrub.js";
import { runCostRecorder } from "./run-cost-recorder.js";
export type { NormalizedStep };

export interface ActiveRun {
  readonly id: string;
  readonly startedAt: string;
  steer(text: string): Promise<AgentSteerOutcome>;
  wait(): Promise<AgentRunResult>;
}

export type SendPromptResult =
  | { ok: true; run: ActiveRun }
  | { ok: false; cause: "never_started"; error: CursorAgentError }
  | { ok: false; cause: "scrub_refused"; message: string };

export interface SendPromptOptions {
  prompt: string;
  /** Per-send model override (not written to conversation meta). */
  model?: string;
  images?: AgentImage[];
}

export interface AgentSessions {
  sendPrompt(
    conversationId: string,
    options: SendPromptOptions,
  ): Promise<SendPromptResult>;
  getActiveRun(conversationId: string): ActiveRun | undefined;
  listActiveRuns(): { conversationId: string }[];
  cancel(conversationId: string): Promise<boolean>;
  dispose(conversationId: string): Promise<void>;
  disposeAll(): Promise<void>;
}

/**
 * One turn in flight. `options` are what a recovery replay re-sends.
 * `isReplay` marks that replay, so a second auth failure surfaces as-is.
 */
type LiveTurn = {
  run: ActiveRun;
  options: SendPromptOptions;
  /** True when this turn is itself the one auth-failure replay. */
  isReplay: boolean;
};

type SessionEntry = {
  handle: AgentHandle;
  /** The turn in flight; absent while the session is idle. */
  turn?: LiveTurn;
  /** Background streaming + persistence; settles when the run finishes. */
  pump?: Promise<void>;
};

/**
 * The SDK surfaces a failed turn as `Connection failed repeatedly` — an in-band
 * error string we do not special-case here (unlike auth failure text in
 * `agent-failure.ts`). When that text appears, check server logs:
 * `http2-diagnostics` may already show `rstCode=11`
 * (`NGHTTP2_ENHANCE_YOUR_CALM`), meaning the peer refused an oversized request
 * rather than a network fault. A conversation already over the HTTP/2 ceiling
 * is only recoverable by continuing in a fresh conversation seeded with a
 * summary.
 */

/** Breathing room before re-entering, in case the rejection was a server-side blip. */
const AUTH_RETRY_DELAY_MS = 1000;

const SCRUB_REFUSED_MESSAGE =
  "Couldn't clear the previous run. Send was refused.";

function isAuthFailureResult(result: AgentRunResult): boolean {
  return classifyAgentFailure(result.status, result.error) === "auth";
}

function conversationStoreDir(conversationId: string): string {
  return join(conversationsDir, conversationId, "agent-state");
}

function publishPlanningRunIssueFrame(issueId: string): void {
  publishFrame(ISSUES_TOPIC, {
    event: { type: "change", id: issueId, scope: "planning-run" },
    persist: false,
  });
}

export { isRunLive } from "./run-live.js";

/**
 * Build a session manager. Tests inject a fake {@link AgentSdk}; production
 * uses the real boundary singleton.
 */
export function createAgentSessions(sdk: AgentSdk = agentSdk): AgentSessions {
  const sessions = new Map<string, SessionEntry>();

  async function ensureHandle(
    conversationId: string,
  ): Promise<{ handle: AgentHandle; entry: SessionEntry }> {
    const existing = sessions.get(conversationId);
    if (existing) return { handle: existing.handle, entry: existing };

    const { meta } = readConversation(conversationId);
    const cwd = requireProjectWorkspace(meta.projectId);
    const model = resolveConversationModel(meta.model);
    const storeDir = conversationStoreDir(conversationId);
    if (!existsSync(storeDir)) {
      mkdirSync(storeDir, { recursive: true });
    }

    // Local SDK sessionId === agentId; preToolUse stdin conversation_id is that
    // value. Tools close over this ref so create can fill it after Agent.create.
    const cursorConversationIdRef: { current: string | undefined } = {
      current: meta.agentId,
    };
    const customTools = createDelegateCustomTools({
      sdk,
      cwd,
      storeDir,
      conversationId,
      getCursorConversationId: () => cursorConversationIdRef.current,
    });

    let handle: AgentHandle;
    if (meta.agentId) {
      try {
        handle = await sdk.resumeAgent(meta.agentId, storeDir, {
          cwd,
          model,
          customTools,
          conversationId,
        });
      } catch (err) {
        handle = await sdk.createAgent({
          cwd,
          model,
          storeDir,
          customTools,
          conversationId,
        });
        cursorConversationIdRef.current = handle.agentId;
        await updateMeta(conversationId, { agentId: handle.agentId });
        await appendEvent(conversationId, {
          type: "error",
          // Starting over is silent from the user's side, so the reason has to
          // travel with it — a resume that fails every time looks like a fresh
          // conversation rather than a bug.
          message:
            "The previous agent session could not be resumed; earlier agent-side context was lost. " +
            `Reason: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    } else {
      handle = await sdk.createAgent({
        cwd,
        model,
        storeDir,
        customTools,
        conversationId,
      });
      cursorConversationIdRef.current = handle.agentId;
      await updateMeta(conversationId, { agentId: handle.agentId });
    }

    const entry: SessionEntry = { handle };
    sessions.set(conversationId, entry);
    return { handle, entry };
  }

  async function stopConversationAgentStackBestEffort(
    conversationId: string,
  ): Promise<void> {
    try {
      await stopAgentStack(conversationId);
    } catch (err) {
      console.error(
        `failed to stop agent stack for conversation ${conversationId}`,
        err,
      );
    }
  }

  async function tearDownEntry(
    conversationId: string,
    entry: SessionEntry,
  ): Promise<void> {
    try {
      await cancelConversationDelegations(conversationId);
    } catch {
      // Continue disposing even if nested cancel fails.
    }
    try {
      if (entry.turn) await entry.handle.cancel();
    } catch {
      // Continue disposing even if cancel fails.
    }
    if (entry.pump) {
      try {
        await entry.pump;
      } catch {
        // Best-effort — pump errors are handled internally.
      }
    }
    try {
      await entry.handle[Symbol.asyncDispose]();
    } catch {
      // Best-effort dispose.
    }
    evictConversationStoreCaches(conversationStoreDir(conversationId));
  }

  /** Stream one run into the transcript, reporting any in-band auth failure. */
  async function pumpEvents(
    conversationId: string,
    agentRun: AgentRun,
  ): Promise<{ sawAuthFailure: boolean }> {
    const pipeline = new EventPipeline(conversationId);
    let sawAuthFailure = false;
    try {
      for await (const event of agentRun) {
        if (!sawAuthFailure && isAuthFailureEvent(event)) sawAuthFailure = true;
        await pipeline.handle(event);
      }
      await pipeline.flush();
    } catch {
      try {
        await pipeline.flush();
      } catch {
        // Best-effort flush after a mid-run failure.
      }
    }
    return { sawAuthFailure };
  }

  /**
   * Prefer the boundary's terminal result (finished / error / cancelled) over a
   * synthesized status — the iterator aborting must not mask e.g. `cancelled`
   * after cancel().
   */
  async function settleResult(agentRun: AgentRun): Promise<AgentRunResult> {
    try {
      return await agentRun.wait();
    } catch (err) {
      return {
        id: agentRun.id,
        status: "error",
        error: { message: err instanceof Error ? err.message : String(err) },
      };
    }
  }

  /**
   * Replay the failed turn once, on the same handle, with the same options.
   *
   * A streaming call that fails unauthenticated invalidates the SDK's cached
   * access token, so the next request re-mints. The SDK does not retry that
   * streaming call itself. One replay covers an expired token; a second auth
   * failure is a revoked or invalid key and surfaces as-is (`isReplay`).
   */
  async function recoverFromAuthFailure(
    conversationId: string,
    options: SendPromptOptions,
  ): Promise<ActiveRun | undefined> {
    const notice = {
      type: "status" as const,
      status: "RETRYING",
      message:
        "The agent session's access token had expired. Reconnected and resumed the conversation.",
    };
    publishFrame(conversationId, { event: notice, persist: true });
    await appendEvent(conversationId, notice);

    await new Promise((resolve) => setTimeout(resolve, AUTH_RETRY_DELAY_MS));

    const reentered = await sendPromptInternal(conversationId, options, true);
    return reentered.ok ? reentered.run : undefined;
  }

  async function sendPromptInternal(
    conversationId: string,
    options: SendPromptOptions,
    isReplay: boolean,
  ): Promise<SendPromptResult> {
    const { prompt, model, images } = options;

    // A missing conversation is not a scrub failure; surface that error as-is.
    readConversation(conversationId);
    try {
      await reconcileOrphanedConversation(conversationId);
    } catch (err) {
      console.error(
        `orphaned run scrub failed for conversation ${conversationId}:`,
        err,
      );
      const event = { type: "error" as const, message: SCRUB_REFUSED_MESSAGE };
      publishFrame(conversationId, { event, persist: true });
      await appendEvent(conversationId, event);
      return {
        ok: false,
        cause: "scrub_refused",
        message: SCRUB_REFUSED_MESSAGE,
      };
    }

    let handle: AgentHandle;
    let entry: SessionEntry;
    try {
      ({ handle, entry } = await ensureHandle(conversationId));
    } catch (err) {
      if (err instanceof CursorAgentError) {
        return { ok: false, cause: "never_started", error: err };
      }
      throw err;
    }

    const sendOptions = model ? { model: { id: model } } : {};
    const message =
      images && images.length > 0 ? { text: prompt, images } : prompt;

    let agentRun: AgentRun;
    try {
      agentRun = await handle.send(message, sendOptions);
    } catch (err) {
      if (err instanceof CursorAgentError) {
        return { ok: false, cause: "never_started", error: err };
      }
      throw err;
    }

    let settleWait!: (result: AgentRunResult) => void;
    const waitPromise = new Promise<AgentRunResult>((resolve) => {
      settleWait = resolve;
    });

    const activeRun: ActiveRun = {
      id: agentRun.id,
      startedAt: new Date().toISOString(),
      steer: (text) => agentRun.steer(text),
      wait: () => waitPromise,
    };
    const turn: LiveTurn = {
      run: activeRun,
      options,
      isReplay,
    };
    entry.turn = turn;
    writeRunLiveMarker(conversationId);
    publishPipelineRunEvent("started", conversationId);

    publishFrame(conversationId, {
      event: { type: "run", status: "started", runId: agentRun.id },
      persist: false,
    });
    const { meta: runMeta } = readConversation(conversationId);
    if (runMeta.issueId) {
      publishPlanningRunIssueFrame(runMeta.issueId);
    }

    entry.pump = (async () => {
      const { sawAuthFailure } = await pumpEvents(conversationId, agentRun);

      publishFrame(conversationId, {
        event: { type: "run", status: "finished", runId: agentRun.id },
        persist: false,
      });
      if (runMeta.issueId) {
        publishPlanningRunIssueFrame(runMeta.issueId);
      }

      const result = await settleResult(agentRun);
      if (result.usage) {
        const usageEvent = {
          type: "run_usage" as const,
          runId: result.id,
          agentId: entry.handle.agentId,
          usage: result.usage,
        };
        publishFrame(conversationId, { event: usageEvent, persist: true });
        await appendEvent(conversationId, usageEvent);
        runCostRecorder.onRunUsage({
          conversationId,
          runId: result.id,
          agentId: entry.handle.agentId,
          endedAt: Date.now(),
        });
      }
      if (entry.turn === turn) {
        entry.turn = undefined;
        clearRunLiveMarker(conversationId);
        publishPipelineRunEvent("finished", conversationId);
      }

      // One replay. A second auth failure surfaces as the replay's own result.
      if (!isReplay && (sawAuthFailure || isAuthFailureResult(result))) {
        const replacement = await recoverFromAuthFailure(
          conversationId,
          options,
        );
        if (replacement) {
          settleWait(await replacement.wait());
          return;
        }
      }

      if (result.status === "finished") {
        const { meta } = readConversation(conversationId);
        const pending = meta.pendingMessage;
        if (pending) {
          await setPendingMessage(conversationId, null);
          await appendEvent(conversationId, {
            type: "prompt",
            text: pending.text,
            ...(pending.attachments?.length
              ? { attachments: pending.attachments }
              : {}),
          });
          const assembled = await assembleAgentPrompt(
            conversationId,
            pending.text,
            pending.attachments,
          );
          const fired = await sendPromptInternal(
            conversationId,
            {
              prompt: assembled.prompt,
              ...(assembled.images ? { images: assembled.images } : {}),
            },
            false,
          );
          if (!fired.ok) {
            await setPendingMessage(
              conversationId,
              pending.text,
              pending.attachments,
            );
            if (fired.cause !== "scrub_refused") {
              const message = fired.error.message;
              const event = { type: "error" as const, message };
              publishFrame(conversationId, { event, persist: true });
              await appendEvent(conversationId, event);
            }
          }
        }
      }

      settleWait(result);
    })();

    return { ok: true, run: activeRun };
  }

  return {
    sendPrompt(conversationId, options) {
      return sendPromptInternal(conversationId, options, false);
    },

    getActiveRun(conversationId) {
      return sessions.get(conversationId)?.turn?.run;
    },

    listActiveRuns() {
      return listConversationIds()
        .filter((conversationId) => sessions.get(conversationId)?.turn?.run)
        .map((conversationId) => ({ conversationId }));
    },

    async cancel(conversationId) {
      const entry = sessions.get(conversationId);
      if (!entry?.turn) return false;
      // Nested first so queued/in-flight delegations stop before the parent
      // run settles from its own cancel.
      await cancelConversationDelegations(conversationId);
      await entry.handle.cancel();
      return true;
    },

    async dispose(conversationId) {
      const entry = sessions.get(conversationId);
      if (entry) {
        sessions.delete(conversationId);
        await tearDownEntry(conversationId, entry);
      }
      await stopConversationAgentStackBestEffort(conversationId);
      clearCatchupBuffer(conversationId);
    },

    async disposeAll() {
      const entries = [...sessions.entries()];
      sessions.clear();
      await Promise.all(
        entries.map(([conversationId, entry]) =>
          tearDownEntry(conversationId, entry),
        ),
      );
      await Promise.all(
        entries.map(([conversationId]) =>
          stopConversationAgentStackBestEffort(conversationId),
        ),
      );
      for (const [conversationId] of entries) {
        clearCatchupBuffer(conversationId);
      }
    },
  };
}

/** Production singleton — wired into server shutdown via {@link disposeAll}. */
export const agentSessions: AgentSessions = createAgentSessions();
