import type {
  SDKCustomTool,
  SDKCustomToolContext,
  SDKCustomToolResult,
  SDKJsonValue,
} from "@cursor/sdk";
import { appendEvent, conversationExists } from "./conversations.js";

type PendingCall = {
  status: "pending";
  promise: Promise<SDKCustomToolResult>;
};

type SettledCall =
  | { status: "fulfilled"; result: SDKCustomToolResult }
  | { status: "rejected"; error: unknown };

type CoalescedCall = PendingCall | SettledCall;

/** Process-lifetime map. A restart drops it, so the next replay runs the tool. */
const calls = new Map<string, CoalescedCall>();

function callKey(conversationId: string, toolCallId: string): string {
  return `${conversationId}\0${toolCallId}`;
}

function toolCallIdOf(context: SDKCustomToolContext): string | undefined {
  return typeof context.toolCallId === "string" && context.toolCallId.length > 0
    ? context.toolCallId
    : undefined;
}

async function recordAbsorbedReplay(
  conversationId: string,
  toolCallId: string,
  tool: string,
  outcome: "joined-in-flight" | "returned-stored-result",
): Promise<void> {
  if (!conversationExists(conversationId)) return;
  await appendEvent(conversationId, {
    type: "absorbed_replay",
    toolCallId,
    tool,
    outcome,
  });
}

async function replayResult(
  existing: CoalescedCall,
  conversationId: string,
  toolCallId: string,
  tool: string,
): Promise<SDKCustomToolResult> {
  const outcome =
    existing.status === "pending" ? "joined-in-flight" : "returned-stored-result";
  await recordAbsorbedReplay(conversationId, toolCallId, tool, outcome);
  if (existing.status === "fulfilled") return existing.result;
  if (existing.status === "rejected") throw existing.error;
  return existing.promise;
}

function remember(
  key: string,
  promise: Promise<SDKCustomToolResult>,
): Promise<SDKCustomToolResult> {
  calls.set(key, { status: "pending", promise });
  promise.then(
    (result) => {
      calls.set(key, { status: "fulfilled", result });
    },
    (error: unknown) => {
      calls.set(key, { status: "rejected", error });
    },
  );
  return promise;
}

/**
 * Wrap every custom tool so a second execute for the same conversation and
 * `toolCallId` waits on the in-flight call or returns its stored result.
 * The tool body, spawn, and concurrency slot belong to the first execute.
 */
export function coalesceCustomTools(
  tools: Record<string, SDKCustomTool>,
  conversationId: string | undefined,
): Record<string, SDKCustomTool> {
  if (conversationId === undefined) return tools;
  const wrapped: Record<string, SDKCustomTool> = {};
  for (const [name, tool] of Object.entries(tools)) {
    wrapped[name] = {
      ...tool,
      execute: (args, context) =>
        executeCoalesced(name, tool, conversationId, args, context),
    };
  }
  return wrapped;
}

function executeCoalesced(
  tool: string,
  inner: SDKCustomTool,
  conversationId: string,
  args: Record<string, SDKJsonValue>,
  context: SDKCustomToolContext,
): SDKCustomToolResult | Promise<SDKCustomToolResult> {
  const toolCallId = toolCallIdOf(context);
  if (toolCallId === undefined) return inner.execute(args, context);

  const key = callKey(conversationId, toolCallId);
  const existing = calls.get(key);
  if (existing) {
    return replayResult(existing, conversationId, toolCallId, tool);
  }

  let promise: Promise<SDKCustomToolResult>;
  try {
    promise = Promise.resolve(inner.execute(args, context));
  } catch (error) {
    promise = Promise.reject(error);
  }
  return remember(key, promise);
}
