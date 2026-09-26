import type { SDKCustomTool, SDKJsonValue } from "@cursor/sdk";
import { z } from "zod";
import {
  agentStackStateSchema,
  startAgentStack,
  stopAgentStack,
} from "./agent-stack.js";
import {
  redeployAgentStack,
  type AgentStackRedeployResult,
} from "./agent-stack-redeploy.js";

const agentStackHandleSchema = z.object({
  state: agentStackStateSchema,
  env: z.record(z.string(), z.string()),
  reused: z.boolean(),
  memoryLimitFailures: z.array(z.string()),
});

export type AgentStackHandleResult = z.infer<typeof agentStackHandleSchema>;

const agentStackStopResultSchema = z.discriminatedUnion("stopped", [
  z.object({
    stopped: z.literal(true),
    state: agentStackStateSchema,
    memoryLimitFailures: z.array(z.string()),
  }),
  z.object({
    stopped: z.literal(false),
    state: z.null(),
    memoryLimitFailures: z.array(z.string()),
  }),
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
        "Start (or reuse) this conversation's verification stack for an issue's Story worktree. Returns AGENT_STACK_PORT, AGENT_STACK_AUX_PORT, AGENT_STACK_DATA_DIR, and AGENT_STACK_BASE_URL. Boots the Project runtime declaration in that worktree, injecting each Project secret into every phase's environment under its own key. Secret values in phase output are masked. Refuses when runtime lacks start or baseUrl, or when a secret key collides with an AGENT_STACK_* variable. Reuse the running stack only when its recorded worktree matches. Do not restart the human's stack on 8060/8061.",
      annotations: AGENT_STACK_START_ANNOTATIONS,
      outputSchema: toolOutputSchema(agentStackHandleSchema),
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
        const handle = await startAgentStack(options.conversationId, {
          issueId,
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
    agent_stack_redeploy: {
      description:
        "Run the Project's redeploy phase in this conversation's live stack worktree with the stack environment and Project secrets, then re-run readiness. Secret values in phase output are masked. Refuses when this conversation has no live stack. When redeploy is empty, returns without running anything because the runtime hot-reloads. Returns each phase's exit status and output tail. Skips readiness when redeploy exits non-zero or readiness is empty.",
      inputSchema: {
        type: "object",
        properties: {},
      },
      execute: async (): Promise<AgentStackRedeployResult> => {
        return redeployAgentStack(options.conversationId);
      },
    },
  };
}
