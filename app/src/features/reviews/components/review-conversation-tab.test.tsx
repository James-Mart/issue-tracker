// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewSubmission } from "@server/schemas";
import type { CommentThread } from "@/features/issues/lib/comment-threads";
import { REVIEW_CONVERSATION_FILTER_STORAGE_KEY } from "../lib/review-conversation-filter";
import { ReviewConversationTab } from "./review-conversation-tab";

const SHA = "a4f91c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b";

const state = vi.hoisted(() => ({
  threads: [] as CommentThread[],
  problems: [] as { id: string; message: string }[],
  isLoading: false,
  error: null as Error | null,
  fileText: null as string | null,
  defaultFileText: Array.from({ length: 100 }, (_, index) => `line ${index + 1}`).join(
    "\n",
  ),
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

vi.mock("@/features/issues/api/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/issues/api/queries")>();
  return {
    ...actual,
    useCommentsQuery: () => ({
      data: { messages: [], threads: [], problems: state.problems },
      isLoading: state.isLoading,
      error: state.error,
    }),
    useReuseCommentThreads: () => ({ threads: state.threads, problems: state.problems }),
    useIssueChangeFileQuery: () => ({
      data: state.fileText ?? state.defaultFileText,
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
  };
});

vi.mock("@/features/issues/api/mutations", () => ({
  usePostComment: () => post,
  useResendComment: () => resend,
  usePostThreadEvent: () => events,
  useEditComment: () => ({ mutateAsync: vi.fn(async () => undefined) }),
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
  state.fileText = null;
  events.isPending = false;
  localStorage.clear();
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

    const noteCard = container.querySelector('[data-thread-root="note"]');
    expect(noteCard?.className).toContain("rounded-md");
    expect(noteCard?.className).toContain("bg-card");
    expect(noteCard?.querySelector('[data-testid="comment-role-badge"]')?.textContent).toBe(
      "Human",
    );
    expect(noteCard?.querySelector("header")?.textContent).toContain("Jared");
    expect(noteCard?.querySelector('[data-testid="thread-resolve"]')).not.toBeNull();
    expect(
      [...(noteCard?.querySelectorAll("button") ?? [])].map((button) =>
        button.textContent?.trim(),
      ),
    ).toEqual(["Resolve"]);
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

  it("shows a question being sent as its researcher looking into it, with no thread actions yet", () => {
    state.threads = [
      thread({
        kind: "question",
        readyToTask: false,
        researcherRun: { status: "running", startedAt: "2026-09-29T14:05:00.000Z" },
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
    expect(card?.querySelector('[data-testid="researcher-running"]')?.textContent).toContain(
      "Researcher is looking into this…",
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
    expect(container.querySelector('[data-thread-root="asked"]')).toBeNull();
    click(container.querySelector('[data-testid="conversation-filter-dismissed"]'));
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

  it("filters the timeline with counted chips and remembers the selection", () => {
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
      thread({
        kind: "question",
        readyToTask: false,
        root: {
          id: "asked",
          at: "2026-09-29T15:00:00.000Z",
          role: "human",
          name: "Jared",
          kind: "question",
          body: "Does the guard consult remotes?",
        },
      }),
      thread({
        kind: "question",
        state: "dismissed",
        readyToTask: false,
        root: {
          id: "dropped",
          at: "2026-09-29T16:00:00.000Z",
          role: "human",
          name: "Jared",
          kind: "question",
          body: "Should we bump OpenSSL?",
        },
      }),
    ];
    const container = mount();
    const chip = (key: string) =>
      container.querySelector(`[data-testid="conversation-filter-${key}"]`);

    expect(chip("comments")?.textContent).toContain("Comments · 1");
    expect(chip("comments")?.getAttribute("aria-pressed")).toBe("true");
    expect(chip("comments")?.querySelector("svg")).not.toBeNull();
    expect(chip("resolved")?.textContent).toContain("Resolved comments · 1");
    expect(chip("resolved")?.getAttribute("aria-pressed")).toBe("true");
    expect(chip("questions")?.textContent).toContain("Questions (open) · 1");
    expect(chip("questions")?.getAttribute("aria-pressed")).toBe("true");
    expect(chip("dismissed")?.textContent).toContain("Dismissed questions · 1");
    expect(chip("dismissed")?.getAttribute("aria-pressed")).toBe("false");
    expect(chip("dismissed")?.querySelector("svg")).toBeNull();
    expect(container.querySelector('[data-testid="conversation-filter-reset"]')).toBeNull();
    expect(container.querySelector('[data-thread-root="dropped"]')).toBeNull();
    expect(container.textContent).toContain("A general note.");
    expect(container.querySelector('[data-thread-root="done"]')?.hasAttribute("data-collapsed")).toBe(
      true,
    );

    click(chip("dismissed"));
    expect(chip("dismissed")?.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector('[data-thread-root="dropped"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="conversation-filter-reset"]')).not.toBeNull();
    expect(localStorage.getItem(REVIEW_CONVERSATION_FILTER_STORAGE_KEY)).toContain(
      '"dismissed":true',
    );

    act(() => root?.unmount());
    const again = mount();
    expect(again.querySelector('[data-thread-root="dropped"]')).not.toBeNull();
    expect(again.querySelector('[data-testid="conversation-filter-reset"]')).not.toBeNull();

    click(again.querySelector('[data-testid="conversation-filter-reset"]'));
    expect(again.querySelector('[data-thread-root="dropped"]')).toBeNull();
    expect(again.querySelector('[data-testid="conversation-filter-reset"]')).toBeNull();
    expect(localStorage.getItem(REVIEW_CONVERSATION_FILTER_STORAGE_KEY)).toBeNull();
  });

  it("shows an empty state when the filter hides every entry", () => {
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
    ];
    const container = mount();
    click(container.querySelector('[data-testid="conversation-filter-comments"]'));
    expect(container.textContent).toContain("Nothing matches these filters.");
    expect(container.textContent).toContain(
      "Turn a category back on, or reset to the default view.",
    );
    expect(container.textContent).not.toContain("A general note.");
    expect(container.querySelector('[data-testid="conversation-filter-reset"]')).not.toBeNull();
  });

  it("keeps a review submission when every chip is off", () => {
    state.threads = [
      thread({
        kind: "question",
        state: "dismissed",
        readyToTask: false,
        root: {
          id: "dropped",
          at: "2026-09-29T16:00:00.000Z",
          role: "human",
          name: "Jared",
          kind: "question",
          body: "Should we bump OpenSSL?",
        },
      }),
    ];
    const done: ReviewSubmission = {
      id: "sub-1",
      at: "2026-09-29T12:00:00.000Z",
      status: "done",
      threadIds: ["dropped"],
      taskIds: ["task-a"],
      conversationId: "conv-1",
    };
    const container = mount(vi.fn(), [done]);
    for (const key of ["comments", "resolved", "questions"]) {
      click(container.querySelector(`[data-testid="conversation-filter-${key}"]`));
    }
    expect(container.querySelector('[data-testid="review-submitted-event"]')).not.toBeNull();
    expect(container.textContent).not.toContain("Nothing matches these filters.");
    expect(container.querySelector('[data-thread-root="dropped"]')).toBeNull();
  });

  it("keeps a wide code block, link, and anchor snippet inside Comments", () => {
    const wide = "w".repeat(240);
    state.fileText = ["context", wide, "context"].join("\n");
    state.threads = [
      thread({
        root: {
          id: "wide",
          at: "2026-09-29T14:05:00.000Z",
          role: "human",
          name: "Ada",
          body: `See [${wide}](https://example.com/${wide})\n\n\`\`\`\n${wide}\n\`\`\``,
          anchor: {
            path: "src/wide.ts",
            side: "new",
            line: 2,
            commitSha: SHA,
          },
        },
      }),
    ];
    const container = mount();

    const comments = container.querySelector(
      '[data-testid="conversation-filter-comments"]',
    );
    expect(comments?.getAttribute("aria-pressed")).toBe("true");

    const tab = container.querySelector('[data-testid="review-conversation-tab"]');
    expect(tab?.className).toContain("review-conversation");

    const pre = tab?.querySelector("pre");
    expect(pre?.textContent).toContain(wide);

    const link = tab?.querySelector(".prose-issue a");
    expect(link?.textContent).toBe(wide);
    expect(link?.getAttribute("href")).toBe(`https://example.com/${wide}`);

    const snippet = tab?.querySelector('[data-testid="comment-anchor-snippet"]');
    expect(snippet?.textContent).toContain(wide);
  });
});
