import type { SDKCustomTool } from "@cursor/sdk";
import {
  startAgentStack,
  stopAgentStack,
  type AgentStackHandle,
  type AgentStackStopResult,
} from "./agent-stack.js";

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
        "Start (or reuse) this conversation's API+Vite verification stack on free ports. Returns the AGENT_STACK_* env contract. Use before verifying server/UI changes; do not restart the human's stack on 8060/8061.",
      inputSchema: {
        type: "object",
        properties: {},
      },
      execute: async (): Promise<AgentStackHandle> => {
        const cursorConversationId = requireCursorConversationId(
          options.getCursorConversationId,
        );
        return startAgentStack(options.conversationId, { cursorConversationId });
      },
    },
    agent_stack_stop: {
      description:
        "Stop this conversation's verification stack, free its ports, and clear durable ownership (state + cursor index).",
      inputSchema: {
        type: "object",
        properties: {},
      },
      execute: async (): Promise<AgentStackStopResult> => {
        return stopAgentStack(options.conversationId);
      },
    },
  };
}
