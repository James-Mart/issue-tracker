import type { SDKCustomTool, SDKJsonValue } from "@cursor/sdk";
import { z } from "zod";
import {
  agentStackStateSchema,
  startAgentStack,
  stopAgentStack,
} from "./agent-stack.js";

const agentStackHandleSchema = z.object({
  state: agentStackStateSchema,
  env: z.record(z.string(), z.string()),
  reused: z.boolean(),
});

export type AgentStackHandleResult = z.infer<typeof agentStackHandleSchema>;

const agentStackStopResultSchema = z.discriminatedUnion("stopped", [
  z.object({ stopped: z.literal(true), state: agentStackStateSchema }),
  z.object({ stopped: z.literal(false), state: z.null() }),
]);

export type AgentStackStopToolResult = z.infer<typeof agentStackStopResultSchema>;

function toolOutputSchema<T extends z.ZodType>(
  schema: T,
): Record<string, SDKJsonValue> {
  return z.toJSONSchema(schema) as Record<string, SDKJsonValue>;
}

const AGENT_STACK_START_ANNOTATIONS = {
  title: "Start verification stack",
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const AGENT_STACK_STOP_ANNOTATIONS = {
  title: "Stop verification stack",
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export interface AgentStackToolOptions {
  /** App conversation that owns the stack (not the Cursor session id). */
  conversationId: string;
  /**
   * Cursor runtime `conversation_id` for this agent session — the same value
   * `preToolUse` hooks receive on stdin. Resolved from the agent runtime
   * (local SDK session / agentId), not via HTTP.
   */
  getCursorConversationId: () => string | undefined;
}

function requireCursorConversationId(
  getCursorConversationId: () => string | undefined,
): string {
  const cursorConversationId = getCursorConversationId();
  if (
    typeof cursorConversationId !== "string" ||
    cursorConversationId.length === 0
  ) {
    throw new Error(
      "agent_stack_start: Cursor conversation_id is not available from the agent runtime yet",
    );
  }
  return cursorConversationId;
}

/**
 * Session-scoped tools: no conversation-id argument — they close over the app
 * conversation and resolve the Cursor session id from the agent runtime.
 */
export function createAgentStackTools(
  options: AgentStackToolOptions,
): Record<string, SDKCustomTool> {
  return {
    agent_stack_start: {
      description:
        "Start (or reuse) this conversation's API+Vite verification stack on free ports for the summary Workspace checkout. Returns the AGENT_STACK_* env contract. The stack reads the live tracker store and refuses writes. Use before verifying server/UI changes; do not restart the human's stack on 8060/8061.",
      annotations: AGENT_STACK_START_ANNOTATIONS,
      outputSchema: toolOutputSchema(agentStackHandleSchema),
      inputSchema: {
        type: "object",
        properties: {
          workspace: {
            type: "string",
            description:
              "Absolute path to the Project workspace checkout (the Workspace: path from issue summary).",
          },
        },
        required: ["workspace"],
      },
      execute: async (input) => {
        const workspace = (input as { workspace?: unknown }).workspace;
        if (typeof workspace !== "string" || !workspace.trim()) {
          throw new Error("agent_stack_start: workspace is required");
        }
        const cursorConversationId = requireCursorConversationId(
          options.getCursorConversationId,
        );
        const handle = await startAgentStack(options.conversationId, {
          workspace,
          cursorConversationId,
        });
        return { ...handle } satisfies AgentStackHandleResult;
      },
    },
    agent_stack_stop: {
      description:
        "Stop this conversation's verification stack, free its ports, and clear durable ownership (state + cursor index).",
      annotations: AGENT_STACK_STOP_ANNOTATIONS,
      outputSchema: toolOutputSchema(agentStackStopResultSchema),
      inputSchema: {
        type: "object",
        properties: {},
      },
      execute: async (): Promise<AgentStackStopToolResult> => {
        return stopAgentStack(options.conversationId);
      },
    },
  };
}
