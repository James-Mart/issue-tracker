import { describe, expect, it } from "vitest";
import type { CommentMessage } from "@server/schemas";
import { humanHandoffView, parseHumanRequestItems } from "./human-request";

function comment(
  overrides: Partial<CommentMessage> &
    Pick<CommentMessage, "id" | "at" | "body">,
): CommentMessage {
  return {
    role: "story-review",
    ...overrides,
  };
}

const REQUEST_BODY = [
  "- Secret `STRIPE_SANDBOX_KEY`: Stripe test-mode key",
  "- Input: webhook URL",
  "- Observation: confirm the dashboard",
].join("\n");

describe("parseHumanRequestItems", () => {
  it("reads secret, input, and observation bullets", () => {
    expect(parseHumanRequestItems(REQUEST_BODY)).toEqual([
      {
        kind: "secret",
        key: "STRIPE_SANDBOX_KEY",
        detail: "Stripe test-mode key",
      },
      { kind: "input", detail: "webhook URL" },
      { kind: "observation", detail: "confirm the dashboard" },
    ]);
  });
});

describe("humanHandoffView", () => {
  const request = comment({
    id: "req",
    at: "2026-09-26T18:00:00.000Z",
    type: "human-request",
    body: REQUEST_BODY,
  });

  it("shows the open request while review is awaiting-human", () => {
    const view = humanHandoffView("awaiting-human", [request]);
    expect(view?.mode).toBe("awaiting");
    expect(view?.request.id).toBe("req");
  });

  it("shows the completed record once a response exists and review is clear", () => {
    const response = comment({
      id: "done",
      at: "2026-09-26T18:14:00.000Z",
      role: "human",
      type: "human-response",
      replyTo: "req",
      body: "key is set",
    });
    const view = humanHandoffView(undefined, [request, response]);
    expect(view?.mode).toBe("completed");
    if (view?.mode === "completed") {
      expect(view.response.body).toBe("key is set");
    }
  });
});
