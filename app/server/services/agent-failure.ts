import type {
  AgentRunError,
  AgentRunStatus,
  AgentStreamEvent,
} from "./agent-sdk.js";

export type AgentFailureClass =
  | "auth"
  | "agent-failed"
  | "cancelled"
  | "stalled-before-first-token"
  | "transport-exhausted";

const CONTROL_MESSAGE_TYPES = new Set(["request", "status", "usage"]);

export function isContentEvent(event: AgentStreamEvent): boolean {
  if (event.kind === "nested") return true;
  if (event.kind !== "message") return false;
  return !CONTROL_MESSAGE_TYPES.has(event.message.type);
}

const AUTH_FAILURE_TEXT =
  /authentication error|unauthenticated|invalid api key|logging out and back in/i;

const AUTH_FAILURE_CODES = new Set([
  "unauthenticated",
  "AUTH_TOKEN_EXPIRED",
  "UNAUTHORIZED",
]);

const TRANSPORT_EXHAUSTION_TEXT = /connection failed repeatedly/i;

const TRANSPORT_EXHAUSTION_CODES = new Set([
  "unavailable",
  "deadline_exceeded",
  "canceled",
  "aborted",
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

function isTransportExhaustion(error: AgentRunError | undefined): boolean {
  if (error === undefined) return false;
  return (
    TRANSPORT_EXHAUSTION_TEXT.test(error.message) ||
    (error.code !== undefined && TRANSPORT_EXHAUSTION_CODES.has(error.code))
  );
}

/** Prefer the SDK's `isRetryable` flag; never infer from failure class. */
export function isRetryableAgentFailure(
  error: AgentRunError | undefined,
): boolean {
  return error?.isRetryable ?? false;
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
  if (isTransportExhaustion(error)) return "transport-exhausted";
  return "agent-failed";
}
