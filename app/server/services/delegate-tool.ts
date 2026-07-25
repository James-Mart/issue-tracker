import { mkdirSync } from "fs";
import { randomUUID } from "crypto";
import { join } from "path";
import type { AgentDefinition, SDKCustomTool } from "@cursor/sdk";
import type { AgentSdk, AgentStreamEvent } from "./agent-sdk.js";
import { EventPipeline } from "./event-pipeline.js";
import {
  formatEffectiveModel,
  resolveModelSelection,
} from "./model-selection.js";
import { loadRoleBody, loadRoleModelPin } from "./role-bodies.js";

/** Interval for live-only nested-run liveness frames. */
export const NESTED_RUN_HEARTBEAT_MS = 5000;

export interface DelegateToolOptions {
  sdk: AgentSdk;
  cwd: string;
  /** Conversation agent-state directory; nested stores are created under it. */
  storeDir: string;
  /**
   * Conversation that receives nested-run `subagent_update` frames. When
   * omitted, the handler still runs the nested agent but does not publish.
   */
  conversationId?: string;
  agents?: Record<string, AgentDefinition>;
  /** Override agents directory (tests). Defaults to the plugin `agents/`. */
  agentsDir?: string;
}

function requireString(
  args: Record<string, unknown>,
  key: string,
): string {
  const value = args[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`delegate: missing or invalid ${key}`);
  }
  return value;
}

function assistantTextFromEvent(event: AgentStreamEvent): string {
  if (event.kind !== "message") return "";
  if (event.message.type !== "assistant") return "";
  let reply = "";
  for (const block of event.message.message.content) {
    if (block.type === "text") reply += block.text;
  }
  return reply;
}

/**
 * Build the `customTools` map containing the app-hosted `delegate` bridge.
 * The same map is passed to every nested agent so delegation works at any depth.
 */
export function createDelegateCustomTools(
  options: DelegateToolOptions,
): Record<string, SDKCustomTool> {
  const customTools: Record<string, SDKCustomTool> = {};
  /** In-flight delegation ids; the top of the stack is the current parent. */
  const delegationStack: string[] = [];

  customTools.delegate = {
    description:
      "Delegate work to a named role. The app selects the role's pinned model.",
    inputSchema: {
      type: "object",
      properties: {
        role: {
          type: "string",
          description: "Spawnable role name (agents/<role>.md).",
        },
        prompt: {
          type: "string",
          description: "Task prompt for the nested agent.",
        },
      },
      required: ["role", "prompt"],
    },
    execute: async (args, context) => {
      const role = requireString(args, "role");
      const prompt = requireString(args, "prompt");
      const agentsDir = options.agentsDir;

      const pin = loadRoleModelPin(role, agentsDir);
      const model = resolveModelSelection(pin);
      const roleBody = loadRoleBody(role, agentsDir);
      const fullPrompt = `${roleBody}\n\n${prompt}`;

      const nestedStoreDir = join(options.storeDir, "nested", randomUUID());
      mkdirSync(nestedStoreDir, { recursive: true });

      const delegationId = randomUUID();
      const parentDelegationId = delegationStack[delegationStack.length - 1];
      const parentCallId =
        typeof context.toolCallId === "string" && context.toolCallId.length > 0
          ? context.toolCallId
          : undefined;
      const pipeline =
        options.conversationId && parentCallId
          ? new EventPipeline(options.conversationId)
          : undefined;
      const stamp = {
        delegationId,
        ...(parentDelegationId !== undefined ? { parentDelegationId } : {}),
        model: formatEffectiveModel(model),
      };

      const handle = await options.sdk.createAgent({
        cwd: options.cwd,
        model,
        storeDir: nestedStoreDir,
        agents: options.agents,
        customTools,
      });

      delegationStack.push(delegationId);
      try {
        const run = await handle.send(fullPrompt);
        let reply = "";
        const startedAt = Date.now();
        let heartbeat: ReturnType<typeof setInterval> | undefined;
        if (pipeline && parentCallId) {
          const callId = parentCallId;
          heartbeat = setInterval(() => {
            void pipeline.emitLiveness(callId, stamp, Date.now() - startedAt);
          }, NESTED_RUN_HEARTBEAT_MS);
        }
        try {
          for await (const event of run) {
            reply += assistantTextFromEvent(event);
            if (pipeline && parentCallId) {
              await pipeline.handleDelegation(parentCallId, stamp, event);
            }
          }
          if (pipeline) await pipeline.flush();

          const waited = await run.wait();
          if (waited.status === "error") {
            throw new Error(
              waited.error?.message ??
                `delegate: nested run ${waited.id} failed`,
            );
          }
          if (waited.status === "cancelled") {
            throw new Error(`delegate: nested run ${waited.id} was cancelled`);
          }
          return { agentId: handle.agentId, reply };
        } catch (err) {
          if (pipeline) {
            try {
              await pipeline.flush();
            } catch {
              // Best-effort flush after a mid-run failure.
            }
          }
          throw err;
        } finally {
          if (heartbeat !== undefined) clearInterval(heartbeat);
        }
      } finally {
        delegationStack.pop();
        try {
          await handle[Symbol.asyncDispose]();
        } catch {
          // Best-effort dispose after the reply is collected.
        }
      }
    },
  };

  return customTools;
}
