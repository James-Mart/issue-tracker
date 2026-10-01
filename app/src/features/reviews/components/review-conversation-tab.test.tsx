// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewSubmission } from "@server/schemas";
import type { CommentThread } from "@/features/issues/lib/comment-threads";
import { ReviewConversationTab } from "./review-conversation-tab";

const SHA = "a4f91c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b";

const state = vi.hoisted(() => ({
  threads: [] as CommentThread[],
  problems: [] as { id: string; message: string }[],
  isLoading: false,
  error: null as Error | null,
}));

const post = vi.hoisted(() => vi.fn());
const resend = vi.hoisted(() => vi.fn());

const events = vi.hoisted(() => ({
  mutate: vi.fn(),
  isPending: false,
}));

vi.mock("@/features/agents/api/queries", () => ({
  useTranscriptionCapabilityQuery: () => ({
    data: { available: true },
    isLoading: false,
    isError: false,
  }),
}));

vi.mock("@/features/issues/api/queries", () => ({
  useCommentsQuery: () => ({
    data: { messages: [], threads: [], problems: state.problems },
    isLoading: state.isLoading,
    error: state.error,
  }),
  useCommentThreads: () => ({ threads: state.threads, problems: state.problems }),
  useIssueChangeFileQuery: () => ({
    data: Array.from({ length: 100 }, (_, index) => `line ${index + 1}`).join("\n"),
  }),
  useIssuesQuery: () => ({
    data: {
      issues: [
        {
          id: "task-a",
          kind: "task",
          title: "Tighten review API errors",
          partOf: "story-1",
          status: "todo",
        },
      ],
    },
  }),
}));

vi.mock("@/features/issues/api/mutations", () => ({
  usePostComment: () => post,
  useResendComment: () => resend,
  usePostThreadEvent: () => events,
}));

function thread(overrides: Partial<CommentThread> & Pick<CommentThread, "root">): CommentThread {
  return {
    kind: "review",
    state: "open",
    readyToTask: true,
    replies: [],
    ...overrides,
  };
}

let root: Root | undefined;

function mount(
  onOpenInDiff = vi.fn(),
  submissions: ReviewSubmission[] = [],
): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <MemoryRouter initialEntries={["/projects/proj/review/stories/story-1"]}>
        <Routes>
          <Route
            path="/projects/:projectId/review/stories/:storyId"
            element={
              <ReviewConversationTab
                storyId="story-1"
                submissions={submissions}
                onOpenInDiff={onOpenInDiff}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );
  });
  return container;
}

function setTextarea(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  if (!setter) throw new Error("no textarea value setter");
  act(() => {
    setter.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function click(element: Element | null) {
  if (!element) throw new Error("no element to click");
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  state.threads = [];
  state.problems = [];
  state.isLoading = false;
  state.error = null;
  events.isPending = false;
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("ReviewConversationTab", () => {
  it("lists comments and threads in time order with anchor, excerpt, and replies", () => {
    state.threads = [
      thread({
        root: {
          id: "note",
          at: "2026-09-28T16:40:00.000Z",
          role: "human",
          name: "Jared",
          body: "A general note.",
        },
      }),
      thread({
        root: {
          id: "anchored",
          at: "2026-09-29T14:05:00.000Z",
          role: "story-review",
          body: "Run the reachability check.",
          outdated: true,
          anchor: {
            path: "app/server/services/diff-fetch.ts",
            side: "new",
            line: 88,
            startLine: 86,
            commitSha: SHA,
          },
        },
        replies: [
          {
            id: "reply",
            at: "2026-09-29T15:22:00.000Z",
            role: "human",
            name: "Jared",
            replyTo: "anchored",
            body: "Agreed.",
          },
        ],
        linkedTaskId: "task-a",
        readyToTask: false,
      }),
    ];
    const onOpenInDiff = vi.fn();
    const container = mount(onOpenInDiff);

    const roots = [...container.querySelectorAll("[data-log-root], [data-thread-root], article")];
    const note = container.textContent?.indexOf("A general note.") ?? -1;
    const anchored = container.textContent?.indexOf("Run the reachability check.") ?? -1;
    expect(note).toBeGreaterThan(-1);
    expect(anchored).toBeGreaterThan(note);
    expect(roots.length).toBeGreaterThan(0);

    const card = container.querySelector('[data-thread-root="anchored"]');
    expect(card?.textContent).toContain("app/server/services/diff-fetch.ts");
    expect(card?.textContent).toContain("lines 86-88");
    expect(card?.textContent).toMatch(/outdated/i);
    expect(card?.textContent).toContain("line 88");
    expect(card?.textContent).toContain("Agreed.");
    expect(card?.querySelector('[data-testid="thread-linked-task"]')?.textContent).toContain(
      "Tighten review API errors",
    );
    const chip = card?.querySelector('[data-testid="thread-linked-task"]');
    const meta = card?.querySelector('[data-testid="comment-anchor-meta"]');
    expect(meta?.contains(chip ?? null)).toBe(false);
    expect(chip?.parentElement?.className).toContain("w-full");

    click(card?.querySelector('[data-testid="see-in-diff"]') ?? null);
    expect(onOpenInDiff).toHaveBeenCalledWith("anchored", SHA);

    click(card?.querySelector('[data-testid="thread-resolve"]') ?? null);
    expect(events.mutate).toHaveBeenCalledWith({
      threadId: "anchored",
      event: "resolved",
    });
  });

  it("labels a file thread File comment with the path and See in diff", () => {
    state.threads = [
      thread({
        root: {
          id: "file-thread",
          at: "2026-09-29T14:05:00.000Z",
          role: "human",
          name: "Jared",
          body: "Look at the whole module.",
          anchor: {
            path: "app/server/services/diff-fetch.ts",
            commitSha: SHA,
          },
        },
      }),
    ];
    const onOpenInDiff = vi.fn();
    const container = mount(onOpenInDiff);
    const card = container.querySelector('[data-thread-root="file-thread"]');
    click(card?.querySelector('[data-testid="see-in-diff"]') ?? null);
    expect(onOpenInDiff).toHaveBeenCalledWith("file-thread", SHA);
  });

  it("posts a general comment from the bottom composer and clears it at once", async () => {
    const container = mount();
    const composer = container.querySelector<HTMLTextAreaElement>(
      '[data-testid="review-conversation-composer"] textarea',
    );
    if (!composer) throw new Error("no composer");
    expect(
      container.querySelector(
        '[data-testid="review-conversation-composer"] [aria-label="Cancel"]',
      ),
    ).toBeNull();
    setTextarea(composer, "Ship the note");
    await act(async () => {
      container
        .querySelector('[data-testid="review-conversation-composer"] [aria-label="Send"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(post).toHaveBeenCalledWith({ role: "human", body: "Ship the note" });
    expect(composer.value).toBe("");
  });

  it("asks a question from the conversation composer", () => {
    const container = mount();
    const composer = container.querySelector<HTMLTextAreaElement>(
      '[data-testid="review-conversation-composer"] textarea',
    );
    if (!composer) throw new Error("no composer");
    setTextarea(composer, "Does the guard consult remotes?");
    click(
      container.querySelector(
        '[data-testid="review-conversation-composer"] [aria-label="Ask a question"]',
      ),
    );

    expect(post).toHaveBeenCalledWith({
      role: "human",
      body: "Does the guard consult remotes?",
      kind: "question",
    });
  });

  it("marks a comment that is still sending beside its time", () => {
    state.threads = [
      thread({
        readyToTask: false,
        root: {
          id: "client-1",
          clientId: "client-1",
          at: "2026-09-29T14:05:00.000Z",
          role: "human",
          body: "Reject empty values before formatting.",
          delivery: { status: "sending" },
        },
      }),
    ];
    const container = mount();
    const mark = container.querySelector('[data-testid="comment-sending"]');
    expect(mark?.textContent).toContain("sending");
    expect(mark?.closest("header")).not.toBeNull();
    expect(container.querySelector('[data-testid="comment-send-retry"]')).toBeNull();
  });

  it("keeps a failed comment in place with its error, and Retry resends it", () => {
    state.threads = [
      thread({
        readyToTask: false,
        root: {
          id: "client-1",
          clientId: "client-1",
          at: "2026-09-29T14:05:00.000Z",
          role: "human",
          body: "Reject empty values before formatting.",
          delivery: { status: "failed", error: "Failed to fetch" },
        },
      }),
    ];
    const container = mount();
    expect(container.textContent).toContain("Reject empty values before formatting.");
    expect(container.querySelector('[data-testid="comment-sending"]')).toBeNull();
    const notice = container.querySelector('[role="alert"]');
    expect(notice?.textContent).toContain("Could not send this comment — Failed to fetch");

    click(container.querySelector('[data-testid="comment-send-retry"]'));
    expect(resend).toHaveBeenCalledWith("client-1");
  });

  it("shows a question being sent as starting its researcher, with no thread actions yet", () => {
    state.threads = [
      thread({
        kind: "question",
        readyToTask: false,
        researcherRun: { status: "starting" },
        root: {
          id: "client-1",
          clientId: "client-1",
          at: "2026-09-29T14:05:00.000Z",
          role: "human",
          kind: "question",
          body: "Does the guard consult remotes?",
          delivery: { status: "sending" },
        },
      }),
    ];
    const container = mount();
    const card = container.querySelector('[data-thread-root="client-1"]');
    expect(card?.querySelector('[data-testid="researcher-starting"]')?.textContent).toBe(
      "Researcher starting…",
    );
    expect(card?.querySelector('[data-testid="comment-sending"]')).not.toBeNull();
    expect(
      [...(card?.querySelectorAll("button") ?? [])].map((button) => button.textContent?.trim()),
    ).toEqual([]);
    expect(card?.querySelector('[data-testid="question-card-footer"]')).toBeNull();
  });

  it("collapses a dismissed question and reopens it without a reply", () => {
    state.threads = [
      thread({
        kind: "question",
        state: "dismissed",
        readyToTask: false,
        linkedTaskId: "task-a",
        root: {
          id: "asked",
          at: "2026-09-29T14:05:00.000Z",
          role: "human",
          name: "Jared",
          kind: "question",
          body: "Does the guard consult remotes?",
        },
        replies: [
          {
            id: "answer",
            at: "2026-09-29T14:20:00.000Z",
            role: "human",
            replyTo: "asked",
            body: "Local refs only.",
          },
        ],
      }),
    ];
    const container = mount();
    const card = container.querySelector('[data-thread-root="asked"]');
    expect(card?.getAttribute("data-collapsed")).toBe("");
    expect(card?.getAttribute("data-thread-kind")).toBe("question");
    expect(card?.hasAttribute("data-ready-to-task")).toBe(false);
    expect(card?.textContent).toContain("Dismissed");
    expect(card?.textContent).not.toContain("Does the guard consult remotes?");
    expect(card?.querySelector('[data-testid="thread-linked-task"]')).toBeNull();
    expect(card?.querySelector('[data-testid="thread-resolve"]')).toBeNull();

    click(card?.querySelector('[data-testid="thread-reopen"]') ?? null);
    expect(events.mutate).toHaveBeenCalledWith({
      threadId: "asked",
      event: "reopened",
    });
  });

  it("opens a question reply empty and keeps thread actions in the footer", () => {
    state.threads = [
      thread({
        kind: "question",
        readyToTask: false,
        root: {
          id: "asked",
          at: "2026-09-29T14:05:00.000Z",
          role: "human",
          name: "Jared",
          kind: "question",
          body: "Would you add a serde_json dep?",
        },
      }),
    ];
    const container = mount();
    const card = container.querySelector('[data-thread-root="asked"]');
    const reply = [...(card?.querySelectorAll("button") ?? [])].find((button) =>
      button.textContent?.includes("Reply"),
    );
    click(reply ?? null);
    expect(card?.querySelector("textarea")?.value).toBe("");
    const footer = card?.querySelector('[data-testid="question-card-footer"]');
    expect(
      [...(footer?.querySelectorAll("button") ?? [])].map((button) =>
        button.textContent?.trim(),
      ),
    ).toEqual(["Dismiss question", "Convert to review comment"]);
    expect(footer?.querySelector('[aria-label="Cancel"]')).toBeNull();
  });

  it("posts convert on an open question", () => {
    state.threads = [
      thread({
        kind: "question",
        readyToTask: false,
        root: {
          id: "asked",
          at: "2026-09-29T14:05:00.000Z",
          role: "human",
          name: "Jared",
          kind: "question",
          body: "Does the guard consult remotes?",
        },
      }),
    ];
    const container = mount();
    click(container.querySelector('[data-testid="thread-convert"]'));
    expect(events.mutate).toHaveBeenCalledWith({
      threadId: "asked",
      event: "converted",
    });
  });

  it("collapses a resolved thread and still offers jump-to-Diff", () => {
    state.threads = [
      thread({
        state: "resolved",
        root: {
          id: "done",
          at: "2026-09-29T14:05:00.000Z",
          role: "human",
          name: "Jared",
          body: "This landed.",
          anchor: {
            path: "src/header.tsx",
            side: "new",
            line: 30,
            commitSha: SHA,
          },
        },
      }),
    ];
    const container = mount();
    const card = container.querySelector('[data-thread-root="done"]');
    expect(card?.hasAttribute("data-collapsed")).toBe(true);
    expect(card?.textContent).toContain("src/header.tsx");
    expect(card?.textContent).toContain("line 30");
    expect(card?.textContent).not.toContain("This landed.");
    expect(card?.querySelector('[data-testid="see-in-diff"]')).not.toBeNull();
    expect(card?.querySelector('[data-testid="thread-unresolve"]')).not.toBeNull();
  });

  it("inserts a finished submission into the timeline", () => {
    state.threads = [
      thread({
        root: {
          id: "note",
          at: "2026-09-28T16:40:00.000Z",
          role: "human",
          name: "Jared",
          body: "A general note.",
        },
      }),
      thread({
        root: {
          id: "later",
          at: "2026-09-29T18:00:00.000Z",
          role: "human",
          name: "Jared",
          body: "After the submission.",
        },
      }),
    ];
    const done: ReviewSubmission = {
      id: "sub-1",
      at: "2026-09-29T12:00:00.000Z",
      status: "done",
      threadIds: ["note", "later"],
      taskIds: ["task-a"],
      conversationId: "conv-1",
    };
    const container = mount(vi.fn(), [done]);
    const text = container.textContent ?? "";
    const note = text.indexOf("A general note.");
    const event = text.indexOf("Review submitted — 2 threads → Task");
    const later = text.indexOf("After the submission.");
    expect(note).toBeGreaterThan(-1);
    expect(event).toBeGreaterThan(note);
    expect(later).toBeGreaterThan(event);
    expect(container.querySelector('[data-testid="review-submitted-event"]')?.textContent).toContain(
      "Tighten review API errors",
    );
    expect(container.querySelector('[data-testid="thread-linked-task"]')?.textContent).toContain(
      "task-a",
    );
  });
});
