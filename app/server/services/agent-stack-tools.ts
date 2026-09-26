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
        "Start (or reuse) this conversation's verification stack for an issue's Story worktree. Returns AGENT_STACK_PORT, AGENT_STACK_AUX_PORT, AGENT_STACK_DATA_DIR, and AGENT_STACK_BASE_URL. A Project with a runtime declaration boots that; a Project with no runtime field boots <worktree>/app on free ports, reading the live tracker store and refusing writes. Reuse the running stack only when its recorded worktree matches. Do not restart the human's stack on 8060/8061.",
      inputSchema: {
        type: "object",
        properties: {
          issueId: {
            type: "string",
            description:
              "Issue whose Story (itself or its containing Story) has the live worktree to boot.",
          },
        },
        required: ["issueId"],
      },
      execute: async (input) => {
        const issueId = (input as { issueId?: unknown }).issueId;
        if (typeof issueId !== "string" || !issueId.trim()) {
          throw new Error("agent_stack_start: issueId is required");
        }
        const cursorConversationId = requireCursorConversationId(
          options.getCursorConversationId,
        );
        const handle: AgentStackHandle = await startAgentStack(options.conversationId, {
          issueId,
          cursorConversationId,
        });
        return { ...handle };
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
