import type {
  AgentRunError,
  AgentRunStatus,
  AgentStreamEvent,
} from "./agent-sdk.js";

export type AgentFailureClass = "auth" | "agent-failed" | "cancelled";

const AUTH_FAILURE_TEXT =
  /authentication error|unauthenticated|invalid api key|logging out and back in/i;

const AUTH_FAILURE_CODES = new Set([
  "unauthenticated",
  "AUTH_TOKEN_EXPIRED",
  "UNAUTHORIZED",
]);

export function isAuthFailureText(text: string): boolean {
  return AUTH_FAILURE_TEXT.test(text);
}

export function isAuthFailureEvent(event: AgentStreamEvent): boolean {
  if (event.kind !== "message") return false;
  const { message } = event;
  return (
    message.type === "status" &&
    message.status === "ERROR" &&
    isAuthFailureText(message.message ?? "")
  );
}

export function classifyAgentFailure(
  status: AgentRunStatus,
  error: AgentRunError | undefined,
): AgentFailureClass {
  if (status === "cancelled") return "cancelled";
  if (
    isAuthFailureText(error?.message ?? "") ||
    (error?.code !== undefined && AUTH_FAILURE_CODES.has(error.code))
  ) {
    return "auth";
  }
  return "agent-failed";
}
