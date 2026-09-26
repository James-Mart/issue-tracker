// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommentMessage, IssueDetail } from "@server/schemas";
import { StoryHumanRequestCard } from "./story-human-request-card";

const mutate = vi.fn();
const commentsState = vi.hoisted(() => ({
  messages: [] as CommentMessage[],
  isLoading: false,
  isError: false,
}));

vi.mock("../api/queries", () => ({
  useCommentsQuery: () => ({
    data: commentsState.isError
      ? undefined
      : { messages: commentsState.messages, problems: [] },
    isLoading: commentsState.isLoading,
    isError: commentsState.isError,
  }),
}));

vi.mock("../api/mutations", () => ({
  useHumanDone: () => ({
    mutate,
    isPending: false,
  }),
}));

const t0 = "2026-09-26T18:00:00.000Z";
const doneAt = "2026-09-26T18:14:00.000Z";

const REQUEST_BODY = [
  "- Secret `STRIPE_SANDBOX_KEY`: Stripe test-mode key",
  "- Input: the public webhook URL",
  "- Observation: confirm the sandbox dashboard",
].join("\n");

function story(
  review?: "awaiting-human" | "passed" | "failed",
): Extract<IssueDetail, { kind: "story" }> {
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
    ...(review ? { review } : {}),
  };
}

function request(body = REQUEST_BODY): CommentMessage {
  return {
    id: "req",
    role: "story-review",
    type: "human-request",
    body,
    at: t0,
  };
}

function response(body: string): CommentMessage {
  return {
    id: "done",
    role: "human",
    type: "human-response",
    replyTo: "req",
    body,
    at: doneAt,
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
  commentsState.messages = [];
  commentsState.isLoading = false;
  commentsState.isError = false;
});

describe("StoryHumanRequestCard", () => {
  it("shows the awaiting request as one list with a Story-review caption", () => {
    commentsState.messages = [request()];
    const { container } = mount(story("awaiting-human"));
    const card = container.querySelector('[data-testid="human-request-card"]');

    expect(card?.getAttribute("data-state")).toBe("awaiting");
    expect(card?.className).toContain("border-warning");
    expect(container.textContent).toContain("Validator needs you");
    expect(container.textContent).toContain("Input: the public webhook URL");
    expect(container.textContent).toContain(
      "Observation: confirm the sandbox dashboard",
    );
    expect(container.textContent).toContain(
      "Done sends the Story back to Story review, which gives the verdict.",
    );
    expect(container.textContent).not.toContain("Input needed");
    expect(container.textContent).not.toContain("Observation needed");
    expect(container.querySelectorAll("li")).toHaveLength(3);
    expect(
      container.querySelectorAll('[data-testid="human-request-done"]'),
    ).toHaveLength(1);
  });

  it("links each secret key to the Project settings Secrets card", () => {
    commentsState.messages = [
      request(
        [
          "- Secret `STRIPE_SANDBOX_KEY`: Stripe test-mode key",
          "- Secret `WEBHOOK_SECRET`: signing secret",
        ].join("\n"),
      ),
    ];
    const { container } = mount(story("awaiting-human"));
    const stripe = container.querySelector(
      '[data-testid="human-request-secret-STRIPE_SANDBOX_KEY"]',
    );
    const webhook = container.querySelector(
      '[data-testid="human-request-secret-WEBHOOK_SECRET"]',
    );

    expect(stripe?.getAttribute("href")).toBe(
      "/projects/issue-tracker/issues/issue-tracker#secrets",
    );
    expect(stripe?.textContent).toBe("STRIPE_SANDBOX_KEY");
    expect(webhook?.getAttribute("href")).toBe(
      "/projects/issue-tracker/issues/issue-tracker#secrets",
    );
  });

  it("posts Done with the note", () => {
    commentsState.messages = [request()];
    const { container } = mount(story("awaiting-human"));
    setNote(container, "  key is set  ");
    pressDone(container);
    expect(mutate).toHaveBeenCalledWith({ note: "key is set" });
  });

  it("posts Done without a note when the field is blank", () => {
    commentsState.messages = [request()];
    const { container } = mount(story("awaiting-human"));
    setNote(container, "   ");
    pressDone(container);
    expect(mutate).toHaveBeenCalledWith({});
  });

  it("shows the completed record with the request, note, and time", () => {
    commentsState.messages = [request(), response("key is set")];
    const { container } = mount(story(undefined));
    const card = container.querySelector('[data-testid="human-request-card"]');
    const time = container.querySelector(
      '[data-testid="human-request-completed-time"]',
    );

    expect(card?.getAttribute("data-state")).toBe("completed");
    expect(card?.className).not.toContain("border-warning");
    expect(container.textContent).toContain("Human step completed");
    expect(container.textContent).toContain("STRIPE_SANDBOX_KEY");
    expect(container.textContent).toContain(
      "Observation: confirm the sandbox dashboard",
    );
    expect(
      container.querySelector('[data-testid="human-request-completed-note"]')
        ?.textContent,
    ).toBe("key is set");
    expect(time?.getAttribute("dateTime")).toBe(doneAt);
    expect(time?.textContent?.trim().length).toBeGreaterThan(0);
    expect(container.querySelector('[data-testid="human-request-done"]')).toBeNull();
  });

  it("shows the completed record without a note block when the response is empty", () => {
    commentsState.messages = [request(), response("")];
    const { container } = mount(story(undefined));
    expect(container.textContent).toContain("Human step completed");
    expect(
      container.querySelector('[data-testid="human-request-completed-note"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="human-request-completed-time"]')
        ?.getAttribute("dateTime"),
    ).toBe(doneAt);
  });
});
