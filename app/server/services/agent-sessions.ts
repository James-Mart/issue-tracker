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
  type AgentStreamEvent,
} from "./agent-sdk.js";
import { loadPluginAgentDefinitions } from "./agent-definitions.js";
import { evictConversationStoreCaches } from "./agent-state-caches.js";
import {
  appendEvent,
  readConversation,
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
import { requireProjectWorkspace } from "./project-workspace.js";

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

type SessionEntry = {
  handle: AgentHandle;
  /** Workspace the handle was built in; the SDK keys its executor cache on it. */
  cwd: string;
  activeRun?: ActiveRun;
  /** Background streaming + persistence; settles when the run finishes. */
  pump?: Promise<void>;
};

/**
 * Text the SDK uses when the access token behind a session has expired. It
 * arrives in-band, as a `status: "ERROR"` message inside a run that otherwise
 * started normally, so it never reaches the SDK's transport-level re-auth path
 * — that one only fires on a `ConnectError` with an `Unauthenticated` code.
 */
const AUTH_FAILURE_TEXT =
  /authentication error|unauthenticated|invalid api key|logging out and back in/i;

/** Breathing room before replaying, in case the rejection was a server-side blip. */
const AUTH_RETRY_DELAY_MS = 1000;

function isAuthFailureEvent(event: AgentStreamEvent): boolean {
  if (event.kind !== "message") return false;
  const { message } = event;
  return (
    message.type === "status" &&
    message.status === "ERROR" &&
    AUTH_FAILURE_TEXT.test(message.message ?? "")
  );
}

function isAuthFailureResult(result: AgentRunResult): boolean {
  return (
    result.status === "error" &&
    AUTH_FAILURE_TEXT.test(result.error?.message ?? "")
  );
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
    const storeDir = join(conversationsDir, conversationId, "agent-state");
    if (!existsSync(storeDir)) {
      mkdirSync(storeDir, { recursive: true });
    }

    const agents = loadPluginAgentDefinitions();
    const customTools = createDelegateCustomTools({
      sdk,
      cwd,
      storeDir,
      conversationId,
      agents,
    });

    let handle: AgentHandle;
    if (meta.agentId) {
      try {
        handle = await sdk.resumeAgent(meta.agentId, storeDir, {
          cwd,
          model,
          agents,
          customTools,
        });
      } catch (err) {
        handle = await sdk.createAgent({
          cwd,
          model,
          storeDir,
          agents,
          customTools,
        });
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
        agents,
        customTools,
      });
      await updateMeta(conversationId, { agentId: handle.agentId });
    }

    const entry: SessionEntry = { handle, cwd };
    sessions.set(conversationId, entry);
    return { handle, entry };
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
      if (entry.activeRun) await entry.handle.cancel();
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
    evictConversationStoreCaches(
      join(conversationsDir, conversationId, "agent-state"),
    );
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
   * Recover from an expired access token, then replay the prompt once.
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
   * different executor holding a different token. A sibling with a run still in
   * flight is left alone too — cancelling live work to repair another
   * conversation is not a trade worth making. Such a sibling keeps the refcount
   * above zero, so the replay fails and the original error surfaces exactly as
   * it does today.
   */
  async function recoverFromAuthFailure(
    conversationId: string,
    entry: SessionEntry,
    options: SendPromptOptions,
  ): Promise<ActiveRun | undefined> {
    // This runs inside `entry.pump`; dropping the reference keeps the teardown
    // below from awaiting the promise it is already executing inside.
    entry.pump = undefined;
    entry.activeRun = undefined;
    sessions.delete(conversationId);
    await tearDownEntry(conversationId, entry);

    const idleSiblings = [...sessions.entries()].filter(
      ([, other]) => other.cwd === entry.cwd && !other.activeRun,
    );
    for (const [id] of idleSiblings) sessions.delete(id);
    await Promise.all(
      idleSiblings.map(([id, other]) => tearDownEntry(id, other)),
    );

    const notice = {
      type: "status" as const,
      status: "RETRYING",
      message:
        "The agent session's access token had expired. Reconnected and resent the last prompt.",
    };
    publishFrame(conversationId, { event: notice, persist: true });
    await appendEvent(conversationId, notice);

    await new Promise((resolve) => setTimeout(resolve, AUTH_RETRY_DELAY_MS));

    const replayed = await sendPromptInternal(conversationId, options, true);
    return replayed.ok ? replayed.run : undefined;
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
    entry.activeRun = activeRun;

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
      if (entry.activeRun === activeRun) {
        entry.activeRun = undefined;
      }

      if (!isReplay && (sawAuthFailure || isAuthFailureResult(result))) {
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

      settleWait(result);
    })();

    return { ok: true, run: activeRun };
  }

  return {
    sendPrompt(conversationId, options) {
      return sendPromptInternal(conversationId, options, false);
    },

    getActiveRun(conversationId) {
      return sessions.get(conversationId)?.activeRun;
    },

    async cancel(conversationId) {
      const entry = sessions.get(conversationId);
      if (!entry?.activeRun) return false;
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
      for (const [conversationId] of entries) {
        clearCatchupBuffer(conversationId);
      }
    },
  };
}

/** Production singleton — wired into server shutdown via {@link disposeAll}. */
export const agentSessions: AgentSessions = createAgentSessions();
