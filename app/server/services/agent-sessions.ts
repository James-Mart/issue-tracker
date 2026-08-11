import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { conversationsDir } from "../config.js";
import {
  agentSdk,
  CursorAgentError,
  type AgentHandle,
  type AgentRun,
  type AgentRunResult,
  type AgentSdk,
} from "./agent-sdk.js";
import { isAuthFailureEvent, isAuthFailureText } from "./agent-failure.js";
import { evictConversationStoreCaches } from "./agent-state-caches.js";
import {
  appendEvent,
  readConversation,
  setPendingMessage,
  updateMeta,
} from "./conversations.js";
import {
  cancelConversationDelegations,
  createDelegateCustomTools,
} from "./delegate-tool.js";
import { clearCatchupBuffer, publishFrame } from "./conversation-stream.js";
import {
  EventPipeline,
  type NormalizedStep,
} from "./event-pipeline.js";
import { stopAgentStack } from "./agent-stack.js";
import { requireProjectWorkspace } from "./project-workspace.js";
import { turnMadeProgress } from "./run-progress.js";

export type { NormalizedStep };

export interface ActiveRun {
  readonly id: string;
  readonly startedAt: string;
  wait(): Promise<AgentRunResult>;
}

export type SendPromptResult =
  | { ok: true; run: ActiveRun }
  | { ok: false; cause: "never_started"; error: CursorAgentError };

export interface SendPromptOptions {
  prompt: string;
  /** Per-send model override (not written to conversation meta). */
  model?: string;
}

export interface AgentSessions {
  sendPrompt(
    conversationId: string,
    options: SendPromptOptions,
  ): Promise<SendPromptResult>;
  getActiveRun(conversationId: string): ActiveRun | undefined;
  cancel(conversationId: string): Promise<boolean>;
  dispose(conversationId: string): Promise<void>;
  disposeAll(): Promise<void>;
}

/**
 * One turn in flight. `options` are what a recovery re-enters with, and
 * `escalated` is the once-per-turn guard: every sibling delegation running when
 * a token expires reports the same `auth` failure, and only the first is worth
 * acting on.
 */
type LiveTurn = {
  run: ActiveRun;
  options: SendPromptOptions;
  /** True when this turn is itself a recovery re-entry. */
  isReplay: boolean;
  escalated: boolean;
  /** Delegate tool calls that reported auth failure before escalation settled. */
  delegateCallFailures?: Map<string, string>;
};

type SessionEntry = {
  handle: AgentHandle;
  /** Workspace the handle was built in; the SDK keys its executor cache on it. */
  cwd: string;
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

/**
 * Re-entry prompt for a turn that got somewhere before the token expired.
 * Recovery is mechanical: this says the turn was cut short and nothing else —
 * it names no task and prescribes no checks.
 */
const CUT_SHORT_PROMPT =
  "The previous turn was cut short by an expired session token. Please carry on.";

function isAuthFailureResult(result: AgentRunResult): boolean {
  return (
    result.status === "error" &&
    isAuthFailureText(result.error?.message ?? "")
  );
}

function conversationStoreDir(conversationId: string): string {
  return join(conversationsDir, conversationId, "agent-state");
}

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
    const model = { id: meta.model };
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
      onAuthFailure: ({ delegationId, agentId, message, parentCallId }) => {
        console.error(
          `conversation ${conversationId}: delegation ${delegationId} ` +
            `(agent ${agentId}) failed authentication: ${message}`,
        );
        const live = sessions.get(conversationId);
        const turn = live?.turn;
        if (parentCallId && turn) {
          if (!turn.delegateCallFailures) {
            turn.delegateCallFailures = new Map();
          }
          turn.delegateCallFailures.set(parentCallId, message);
        }
        // A turn that is already recovering owns the repair; the failure
        // reaches the calling model as data either way.
        if (!live || !turn || turn.isReplay || turn.escalated) return;
        turn.escalated = true;
        void escalateDelegationAuthFailure(conversationId, live, turn).catch(
          (err) => {
            console.error(
              `failed to escalate a delegation auth failure for conversation ${conversationId}`,
              err,
            );
          },
        );
      },
    });

    let handle: AgentHandle;
    if (meta.agentId) {
      try {
        handle = await sdk.resumeAgent(meta.agentId, storeDir, {
          cwd,
          model,
          customTools,
        });
      } catch (err) {
        handle = await sdk.createAgent({
          cwd,
          model,
          storeDir,
          customTools,
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
      });
      cursorConversationIdRef.current = handle.agentId;
      await updateMeta(conversationId, { agentId: handle.agentId });
    }

    const entry: SessionEntry = { handle, cwd };
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
   * Recover from an expired access token, then re-enter the agent once with
   * `options` — which the caller chooses, so it may carry the original prompt
   * or a continuation.
   *
   * The SDK caches one local executor per workspace + API key + setting-source
   * tuple, mints an access token when it builds one, and tears the executor
   * down only after every handle sharing that tuple is disposed. This app keeps
   * a handle per conversation for the life of the process, so the token is
   * never re-minted and every send past its expiry fails — which is why
   * restarting the server is otherwise the only thing that clears it.
   * Reported upstream: https://forum.cursor.com/t/164755
   *
   * Dropping the handles is the part of a restart that matters, so do only
   * that, and only for the affected workspace: sessions elsewhere key a
   * different executor holding a different token. A sibling conversation with a
   * run still in flight is left alone too — cancelling live work to repair
   * another conversation is not a trade worth making. Such a sibling keeps the
   * refcount above zero, so the re-entry fails and the original error surfaces
   * exactly as it does today.
   *
   * This conversation's own nested delegations are cancelled by the teardown
   * and never waited on: they were created against the same workspace, so
   * waiting for one to finish would be waiting on a handle that is itself
   * holding the refcount up.
   */
  async function recoverFromAuthFailure(
    conversationId: string,
    entry: SessionEntry,
    options: SendPromptOptions,
  ): Promise<ActiveRun | undefined> {
    // The pump has nothing left to do here — the in-band caller runs inside it,
    // and the escalating caller has already awaited the turn's result — so drop
    // the reference rather than have the teardown await a promise its caller
    // may be executing inside.
    entry.pump = undefined;
    entry.turn = undefined;
    sessions.delete(conversationId);
    await tearDownEntry(conversationId, entry);

    const idleSiblings = [...sessions.entries()].filter(
      ([, other]) => other.cwd === entry.cwd && !other.turn,
    );
    for (const [id] of idleSiblings) sessions.delete(id);
    await Promise.all(
      idleSiblings.map(([id, other]) => tearDownEntry(id, other)),
    );

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

  /**
   * Carry an `auth` failure a delegation reported up to the conversation whose
   * turn is running it.
   *
   * The model can do nothing useful once the executor behind its session is
   * stale — every delegation it retries dies against the same one — so the turn
   * is cancelled and re-entered instead of left to keep trying.
   *
   * Escalating is only safe once that cancel has settled. If it has not, the
   * resume inside the recovery meets an agent that still has an active run,
   * falls back to a fresh agent, and loses the context of the long-running loop
   * the escalation exists to rescue. So a turn that does not come back
   * `cancelled` is left alone, and the delegation's failure surfaces to the
   * calling model exactly as it does today.
   */
  async function escalateDelegationAuthFailure(
    conversationId: string,
    entry: SessionEntry,
    turn: LiveTurn,
  ): Promise<void> {
    try {
      await entry.handle.cancel();
    } catch {
      // A cancel that throws is one that cannot be confirmed settled below.
    }

    const result = await turn.run.wait();
    if (result.status !== "cancelled") return;

    if (turn.delegateCallFailures && turn.delegateCallFailures.size > 0) {
      const pipeline = new EventPipeline(conversationId);
      for (const [callId, message] of turn.delegateCallFailures) {
        await pipeline.failToolCall(callId, {
          name: "delegate",
          failureClass: "auth",
          message,
        });
      }
    }

    const madeProgress = await turnMadeProgress(
      conversationStoreDir(conversationId),
      entry.handle.agentId,
    );
    await recoverFromAuthFailure(
      conversationId,
      entry,
      madeProgress
        ? { ...turn.options, prompt: CUT_SHORT_PROMPT }
        : turn.options,
    );
  }

  async function sendPromptInternal(
    conversationId: string,
    options: SendPromptOptions,
    isReplay: boolean,
  ): Promise<SendPromptResult> {
    const { prompt, model } = options;

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

    let agentRun: AgentRun;
    try {
      agentRun = await handle.send(
        prompt,
        model ? { model: { id: model } } : {},
      );
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
      wait: () => waitPromise,
    };
    const turn: LiveTurn = {
      run: activeRun,
      options,
      isReplay,
      escalated: false,
    };
    entry.turn = turn;

    publishFrame(conversationId, {
      event: { type: "run", status: "started", runId: agentRun.id },
      persist: false,
    });

    entry.pump = (async () => {
      const { sawAuthFailure } = await pumpEvents(conversationId, agentRun);

      publishFrame(conversationId, {
        event: { type: "run", status: "finished", runId: agentRun.id },
        persist: false,
      });

      const result = await settleResult(agentRun);
      if (entry.turn === turn) {
        entry.turn = undefined;
      }

      // An escalation from a delegation already owns this turn's recovery, and
      // it cancelled this run to get there — the two must not both tear the
      // session down and re-enter.
      if (
        !isReplay &&
        !turn.escalated &&
        (sawAuthFailure || isAuthFailureResult(result))
      ) {
        const replacement = await recoverFromAuthFailure(
          conversationId,
          entry,
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
          });
          const fired = await sendPromptInternal(
            conversationId,
            { prompt: pending.text },
            false,
          );
          if (!fired.ok) {
            await setPendingMessage(conversationId, pending.text);
            const message = fired.error.message;
            const event = { type: "error" as const, message };
            publishFrame(conversationId, { event, persist: true });
            await appendEvent(conversationId, event);
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
