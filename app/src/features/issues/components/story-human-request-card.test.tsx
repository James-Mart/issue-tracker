// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IssueDetail } from "@server/schemas";
import { StoryHumanRequestCard } from "./story-human-request-card";

const mutate = vi.fn();
const REQUEST_BODY = [
  "- Secret `STRIPE_SANDBOX_KEY`: Stripe test-mode key",
  "- Input: the public webhook URL",
  "- Observation: confirm the sandbox dashboard",
].join("\n");

vi.mock("../api/queries", () => ({
  useCommentsQuery: () => ({
    data: {
      messages: [
        {
          id: "req",
          role: "story-review",
          type: "human-request",
          body: REQUEST_BODY,
          at: "2026-09-26T18:00:00.000Z",
        },
      ],
      problems: [],
    },
    isLoading: false,
    isError: false,
  }),
}));

vi.mock("../api/mutations", () => ({
  useHumanDone: () => ({
    mutate,
    isPending: false,
  }),
}));

const t0 = "2026-09-26T18:00:00.000Z";

function story(): Extract<IssueDetail, { kind: "story" }> {
  return {
    id: "handoff",
    kind: "story",
    title: "Human handoff",
    partOf: "runtime-validation-loop",
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    archived: false,
    description: "Story body",
    version: "1",
    labels: [],
    needsAttention: false,
    attentionReason: null,
    branchName: "human-handoff",
    merged: false,
    reviewedTasks: [],
    review: "awaiting-human",
  };
}

function mount(issue: Extract<IssueDetail, { kind: "story" }>): {
  container: HTMLDivElement;
  root: Root;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={["/projects/issue-tracker/issues/handoff"]}>
        <Routes>
          <Route
            path="/projects/:projectId/issues/:id"
            element={<StoryHumanRequestCard issue={issue} />}
          />
        </Routes>
      </MemoryRouter>,
    );
  });
  return { container, root };
}

function setNote(container: ParentNode, value: string) {
  const input = container.querySelector(
    '[data-testid="human-request-note"]',
  ) as HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function pressDone(container: ParentNode) {
  const button = container.querySelector('[data-testid="human-request-done"]');
  act(() => {
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

afterEach(() => {
  document.body.innerHTML = "";
  mutate.mockReset();
});

describe("StoryHumanRequestCard", () => {
  it("posts Done with the note", () => {
    const { container } = mount(story());
    setNote(container, "  key is set  ");
    pressDone(container);
    expect(mutate).toHaveBeenCalledWith({ note: "key is set" });
  });
});
