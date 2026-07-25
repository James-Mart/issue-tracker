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
import { loadPluginAgentDefinitions } from "./agent-definitions.js";
import {
  appendEvent,
  readConversation,
  updateMeta,
} from "./conversations.js";
import { createDelegateCustomTools } from "./delegate-tool.js";
import {
  EventPipeline,
  type NormalizedStep,
} from "./event-pipeline.js";
import { requireProjectWorkspace } from "./project-workspace.js";

export type { NormalizedStep };

export interface ActiveRun {
  readonly id: string;
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
  activeRun?: ActiveRun;
  /** Background streaming + persistence; settles when the run finishes. */
  pump?: Promise<void>;
};

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
      agents,
    });

    let handle: AgentHandle;
    if (meta.agentId) {
      try {
        handle = await sdk.resumeAgent(meta.agentId, storeDir, {
          agents,
          customTools,
        });
      } catch {
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
          message:
            "The previous agent session could not be resumed; earlier agent-side context was lost.",
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

    const entry: SessionEntry = { handle };
    sessions.set(conversationId, entry);
    return { handle, entry };
  }

  async function tearDownEntry(entry: SessionEntry): Promise<void> {
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
  }

  return {
    async sendPrompt(conversationId, { prompt, model }) {
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
        wait: () => waitPromise,
      };
      entry.activeRun = activeRun;

      entry.pump = (async () => {
        const pipeline = new EventPipeline(conversationId);
        try {
          for await (const event of agentRun) {
            await pipeline.handle(event);
          }
          await pipeline.flush();
        } catch {
          try {
            await pipeline.flush();
          } catch {
            // Best-effort flush after a mid-run failure.
          }
        } finally {
          // Prefer the boundary's terminal result (finished / error / cancelled)
          // over a synthesized status — the iterator aborting must not mask
          // e.g. `cancelled` after cancel().
          try {
            settleWait(await agentRun.wait());
          } catch (err) {
            settleWait({
              id: agentRun.id,
              status: "error",
              error: {
                message: err instanceof Error ? err.message : String(err),
              },
            });
          }
          if (entry.activeRun === activeRun) {
            entry.activeRun = undefined;
          }
        }
      })();

      return { ok: true, run: activeRun };
    },

    getActiveRun(conversationId) {
      return sessions.get(conversationId)?.activeRun;
    },

    async cancel(conversationId) {
      const entry = sessions.get(conversationId);
      if (!entry?.activeRun) return false;
      await entry.handle.cancel();
      return true;
    },

    async dispose(conversationId) {
      const entry = sessions.get(conversationId);
      if (!entry) return;
      sessions.delete(conversationId);
      await tearDownEntry(entry);
    },

    async disposeAll() {
      const entries = [...sessions.values()];
      sessions.clear();
      await Promise.all(entries.map((entry) => tearDownEntry(entry)));
    },
  };
}

/** Production singleton — wired into server shutdown via {@link disposeAll}. */
export const agentSessions: AgentSessions = createAgentSessions();
