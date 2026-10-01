// @vitest-environment happy-dom
import {
  AT,
  AT_END,
  clickHeader,
  deliverTopic,
  eventsQueryState,
  mountPanel,
  PROJECT_ID,
  queryState,
  sampleRun,
  topicState,
} from "./agent-runs-panel.test-helpers";
import { describe, expect, it } from "vitest";

describe("researcher runs in the Agents tab", () => {
  it("renders a researcher transcript in the run body and links the answered thread", () => {
    queryState.data = {
      runs: [
        sampleRun({
          delegationId: "review-question:conv-r",
          role: "issue-tracker-review-question",
          conversationId: "conv-r",
          parentCallId: "conv-r",
          issueId: "story-1",
          threadId: "q-1",
          status: "completed",
          endedAt: AT_END,
        }),
      ],
      workRoot: undefined,
    };
    eventsQueryState.data = {
      events: [
        {
          type: "prompt",
          text: "ROLE BODY that must stay out of the card",
          at: AT,
          seq: 1,
        },
        {
          type: "assistant",
          text: "The anchor is stable.",
          at: AT,
          seq: 2,
        },
        {
          type: "prompt",
          text: "follow up",
          at: AT,
          seq: 3,
        },
        {
          type: "assistant",
          text: "Still stable.",
          at: AT,
          seq: 4,
        },
        {
          type: "tool_call",
          callId: "tool-1",
          name: "Read",
          status: "completed",
          args: { path: "a.ts" },
          at: AT,
          seq: 5,
        },
      ],
    };

    const { container } = mountPanel({
      issueId: "story-1",
      projectId: PROJECT_ID,
    });
    clickHeader(container, "review-question:conv-r");

    const texts = Array.from(
      container.querySelectorAll('[data-run-step="text"]'),
    ).map((node) => node.textContent);
    expect(texts).toEqual(["The anchor is stable.", "Still stable."]);
    expect(container.textContent).not.toContain("ROLE BODY");
    expect(container.textContent).not.toContain("follow up");
    expect(container.querySelector('[data-run-step="tool_call"]')).toBeTruthy();
    expect(container.textContent).toContain("Read");
    expect(
      container
        .querySelector('[data-testid="agent-run-thread-link"]')
        ?.getAttribute("href"),
    ).toBe("/projects/platform/issues/story-1?tab=diff&thread=q-1");
  });

  it("streams a live researcher run into the same body", () => {
    queryState.data = {
      runs: [
        sampleRun({
          delegationId: "review-question:conv-r",
          role: "issue-tracker-review-question",
          conversationId: "conv-r",
          parentCallId: "conv-r",
          status: "running",
          endedAt: undefined,
          threadId: "q-1",
        }),
      ],
      workRoot: undefined,
    };
    eventsQueryState.data = { events: [] };

    const { container } = mountPanel({ issueId: "task-1", projectId: PROJECT_ID });
    expect(topicState.listeners.has("conversation:conv-r")).toBe(true);
    expect(
      container.querySelector(
        '[data-run-id="review-question:conv-r"] [data-slot="agent-run-body"]',
      ),
    ).toBeTruthy();

    deliverTopic("conversation:conv-r", {
      type: "event",
      seq: 1,
      event: { type: "assistant", text: "The ", at: AT, seq: 1 },
    });
    deliverTopic("conversation:conv-r", {
      type: "event",
      seq: 2,
      event: { type: "assistant", text: "anchor holds.", at: AT, seq: 2 },
    });
    deliverTopic("conversation:conv-r", {
      type: "event",
      seq: 3,
      event: {
        type: "tool_call",
        callId: "tool-live",
        name: "Read",
        status: "running",
        args: { path: "panel.tsx" },
        at: AT,
        seq: 3,
      },
    });

    expect(
      container.querySelector('[data-run-step="text"]')?.textContent,
    ).toBe("The anchor holds.");
    expect(container.querySelectorAll('[data-run-step="text"]')).toHaveLength(1);
    expect(container.textContent).toContain("Read");
  });
});
