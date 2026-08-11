import type { SDKMessage } from "@cursor/sdk";
import { describe, expect, it } from "vitest";
import type { AgentRunError, AgentStreamEvent } from "./agent-sdk.js";
import {
  classifyAgentFailure,
  isAuthFailureEvent,
  isAuthFailureText,
  isContentEvent,
  isRetryableAgentFailure,
} from "./agent-failure.js";

const AUTH_ERROR_TEXT =
  "Authentication error. If you are logged in, try logging out and back in.";

function statusError(message: string): AgentStreamEvent {
  const msg: SDKMessage = {
    type: "status",
    agent_id: "agent-1",
    run_id: "run-1",
    status: "ERROR",
    message,
  };
  return { kind: "message", message: msg };
}

describe("isAuthFailureText", () => {
  it("matches the in-band authentication error string", () => {
    expect(isAuthFailureText(AUTH_ERROR_TEXT)).toBe(true);
  });

  it("does not match unrelated errors", () => {
    expect(isAuthFailureText("Connection failed repeatedly")).toBe(false);
  });
});

describe("isAuthFailureEvent", () => {
  it("matches a status ERROR message with auth text", () => {
    expect(isAuthFailureEvent(statusError(AUTH_ERROR_TEXT))).toBe(true);
  });

  it("ignores non-message events", () => {
    expect(
      isAuthFailureEvent({
        kind: "nested",
        callId: "c1",
        modelCallId: "m1",
        update: { type: "text-delta", text: AUTH_ERROR_TEXT },
      }),
    ).toBe(false);
  });

  it("ignores status messages that are not ERROR", () => {
    const msg: SDKMessage = {
      type: "status",
      agent_id: "agent-1",
      run_id: "run-1",
      status: "FINISHED",
      message: AUTH_ERROR_TEXT,
    };
    expect(isAuthFailureEvent({ kind: "message", message: msg })).toBe(false);
  });
});

describe("isContentEvent", () => {
  const ids = { agent_id: "agent-1", run_id: "run-1" } as const;

  it.each(["request", "status", "usage"] as const)(
    "returns false for control message type %s",
    (type) => {
      const msg: SDKMessage =
        type === "request"
          ? { type, ...ids, request_id: "req-1" }
          : type === "status"
            ? { type, ...ids, status: "RUNNING" }
            : {
                type,
                ...ids,
                usage: {
                  inputTokens: 1,
                  outputTokens: 0,
                  cacheReadTokens: 0,
                  cacheWriteTokens: 0,
                  totalTokens: 1,
                },
              };
      expect(isContentEvent({ kind: "message", message: msg })).toBe(false);
    },
  );

  it("returns true for an unrecognised message type", () => {
    expect(
      isContentEvent({
        kind: "message",
        message: {
          type: "future-sdk-event" as "assistant",
          ...ids,
        },
      }),
    ).toBe(true);
  });

  it("returns true for nested events", () => {
    expect(
      isContentEvent({
        kind: "nested",
        callId: "call-1",
        modelCallId: "model-1",
        update: { type: "text-delta", text: "hi" },
      }),
    ).toBe(true);
  });
});

describe("classifyAgentFailure", () => {
  it("returns auth for auth failure text", () => {
    expect(
      classifyAgentFailure("error", { message: AUTH_ERROR_TEXT }),
    ).toBe("auth");
  });

  it.each(["unauthenticated", "AUTH_TOKEN_EXPIRED", "UNAUTHORIZED"])(
    "returns auth for error code %s",
    (code) => {
      expect(
        classifyAgentFailure("error", { message: "something else", code }),
      ).toBe("auth");
    },
  );

  it("returns cancelled for cancelled status", () => {
    expect(classifyAgentFailure("cancelled", undefined)).toBe("cancelled");
  });

  it("returns transport-exhausted for Connection failed repeatedly text", () => {
    expect(
      classifyAgentFailure("error", {
        message: "Connection failed repeatedly",
      }),
    ).toBe("transport-exhausted");
  });

  it.each([
    "unavailable",
    "deadline_exceeded",
    "canceled",
    "aborted",
  ] as const)("returns transport-exhausted for error code %s", (code) => {
    expect(
      classifyAgentFailure("error", { message: "something else", code }),
    ).toBe("transport-exhausted");
  });

  it("returns auth when auth text and a transport code both appear", () => {
    expect(
      classifyAgentFailure("error", {
        message: AUTH_ERROR_TEXT,
        code: "unavailable",
      }),
    ).toBe("auth");
  });

  it("returns agent-failed for an unknown error", () => {
    const error: AgentRunError = {
      message: "something went wrong",
      code: "NETWORK",
    };
    expect(classifyAgentFailure("error", error)).toBe("agent-failed");
  });

  it("returns agent-failed for a finished run with no error", () => {
    expect(classifyAgentFailure("finished", undefined)).toBe("agent-failed");
  });
});

describe("isRetryableAgentFailure", () => {
  it("passes through the SDK isRetryable flag when present", () => {
    expect(
      isRetryableAgentFailure({
        message: "Connection failed repeatedly",
        isRetryable: true,
      }),
    ).toBe(true);
    expect(
      isRetryableAgentFailure({
        message: "Connection failed repeatedly",
        isRetryable: false,
      }),
    ).toBe(false);
  });

  it("defaults to false when isRetryable is absent", () => {
    expect(
      isRetryableAgentFailure({ message: "Connection failed repeatedly" }),
    ).toBe(false);
  });
});
