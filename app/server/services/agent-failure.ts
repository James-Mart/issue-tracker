import type {
  AgentRunError,
  AgentRunStatus,
  AgentStreamEvent,
} from "./agent-sdk.js";

export type AgentFailureClass =
  | "auth"
  | "agent-failed"
  | "cancelled"
  | "host-process-died"
  | "stalled-before-first-token"
  | "transport-exhausted";

const CONTROL_MESSAGE_TYPES = new Set(["request", "status", "usage"]);

export function isContentEvent(event: AgentStreamEvent): boolean {
  if (event.kind === "nested") return true;
  if (event.kind !== "message") return false;
  return !CONTROL_MESSAGE_TYPES.has(event.message.type);
}

// In-band status ERROR events carry text only — no SDK error code on the stream.
const AUTH_FAILURE_TEXT =
  /authentication error|unauthenticated|invalid api key|logging out and back in/i;

const AUTH_FAILURE_NAMES = new Set(["AuthenticationError"]);

const AUTH_FAILURE_CODES = new Set([
  "unauthenticated",
  "AUTH_TOKEN_EXPIRED",
  "UNAUTHORIZED",
  "AUTH_TOKEN_NOT_FOUND",
]);

// Synthesized when the SDK exhausts transport retries — no stable code on the error.
const TRANSPORT_EXHAUSTION_TEXT = /connection failed repeatedly/i;

const TRANSPORT_FAILURE_NAMES = new Set(["NetworkError"]);

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

function isAuthFailure(error: AgentRunError | undefined): boolean {
  if (error === undefined) return false;
  return (
    (error.name !== undefined && AUTH_FAILURE_NAMES.has(error.name)) ||
    (error.code !== undefined && AUTH_FAILURE_CODES.has(error.code))
  );
}

function isTransportExhaustion(error: AgentRunError | undefined): boolean {
  if (error === undefined) return false;
  return (
    (error.name !== undefined && TRANSPORT_FAILURE_NAMES.has(error.name)) ||
    (error.code !== undefined && TRANSPORT_EXHAUSTION_CODES.has(error.code)) ||
    TRANSPORT_EXHAUSTION_TEXT.test(error.message)
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
  if (isAuthFailure(error)) return "auth";
  if (isTransportExhaustion(error)) return "transport-exhausted";
  return "agent-failed";
}
