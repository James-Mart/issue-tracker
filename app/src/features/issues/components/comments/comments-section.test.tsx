// @vitest-environment happy-dom
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useSearchParams } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommentMessage, CommentThreadView, IssueDetail } from "@server/schemas";
import { commentDayLabel } from "./marker";
import { IssueCommentsSection } from "./comments-section";

const SHA = "a4f91c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b";

const commentsState = vi.hoisted(() => ({
  messages: [] as CommentMessage[],
  threads: [] as CommentThreadView[],
  isLoading: false,
  error: null as Error | null,
}));

const postComment = vi.hoisted(() => vi.fn());

const useCommentsQuery = vi.hoisted(() =>
  vi.fn(() => ({
    data: {
      messages: commentsState.messages,
      threads: commentsState.threads,
      problems: [],
    },
    isLoading: commentsState.isLoading,
    error: commentsState.error,
  })),
);

vi.mock("@/features/agents/api/queries", () => ({
  useTranscriptionCapabilityQuery: () => ({
    data: { available: true },
    isLoading: false,
    isError: false,
  }),
}));

vi.mock("../../api/queries", async () => {
  const { groupCommentThreads } = await import("../../lib/comment-threads");
  return {
    useCommentsQuery,
    useCommentThreads: () => ({
      threads: groupCommentThreads(commentsState.messages, commentsState.threads),
      problems: [],
      loaded: true,
    }),
    useIssuesQuery: () => ({ data: undefined }),
    useIssueChangeFileQuery: () => ({
      data: Array.from({ length: 100 }, (_, index) => `line ${index + 1}`).join(
        "\n",
      ),
    }),
  };
});

vi.mock("../../api/mutations", () => ({
  usePostComment: () => postComment,
  usePostThreadEvent: () => ({ mutate: vi.fn(), isPending: false }),
  useEditComment: () => ({ mutateAsync: vi.fn(async () => undefined) }),
}));

function comment(
  overrides: Partial<CommentMessage> &
    Pick<CommentMessage, "id" | "at" | "body" | "role">,
): CommentMessage {
  return { ...overrides };
}

const standaloneEarly = comment({
  id: "standalone-early",
  at: "2026-08-30T10:00:00.000Z",
  role: "human",
  name: "Jared",
  body: "Keep ordinary notes visually lighter than threads.",
});

const unanchoredRoot = comment({
  id: "unanchored-root",
  at: "2026-08-30T11:00:00.000Z",
  role: "planner",
  body: "Fold outdated comments, or keep them in the stream?",
});

const unanchoredReply = comment({
  id: "unanchored-reply",
  at: "2026-08-30T11:20:00.000Z",
  role: "human",
  name: "Jared",
  replyTo: "unanchored-root",
  body: "Same stream — dim them, keep the snippet readable.",
});

const standaloneLate = comment({
  id: "standalone-late",
  at: "2026-08-30T12:00:00.000Z",
  role: "implementor",
  body: "Wired the Comments panel to the shared thread model.",
});

const anchoredRoot = comment({
  id: "anchored-root",
  at: "2026-08-30T13:00:00.000Z",
  role: "story-review",
  body: "Scope drafts per thread so Diff and Overview stay isolated.",
  anchor: {
    path: "app/server/services/diff-fetch.ts",
    side: "new",
    line: 94,
    commitSha: SHA,
  },
});

const mixedLog: CommentMessage[] = [
  standaloneLate,
  anchoredRoot,
  unanchoredReply,
  unanchoredRoot,
  standaloneEarly,
];

function task(): IssueDetail {
  return {
    id: "threads-in-comment-log",
    kind: "task",
    title: "Thread the comment log",
    partOf: "comment-log-threads",
    order: 0,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    needsAttention: false,
    attentionReason: null,
    archived: false,
    description: "",
    version: "1",
    status: "in-progress",
    commits: [],
  };
}

function SearchProbe({
  onSearch,
}: {
  onSearch: (search: string) => void;
}) {
  const [params] = useSearchParams();
  useEffect(() => {
    onSearch(params.toString());
  }, [onSearch, params]);
  return null;
}

function story(): IssueDetail {
  return {
    id: "story-threads",
    kind: "story",
    title: "Story threads",
    partOf: "review-conversations",
    order: 0,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    needsAttention: false,
    attentionReason: null,
    archived: false,
    description: "",
    version: "1",
    merged: false,
    reviewedTasks: [],
  };
}

function mount(
  onSearch?: (search: string) => void,
  issue: IssueDetail = task(),
  entry = "/",
  inert = false,
): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const section = <IssueCommentsSection issue={issue} />;
  const hidden = inert ? { inert: "" } : {};
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[entry]}>
        {onSearch ? <SearchProbe onSearch={onSearch} /> : null}
        {inert ? <div {...hidden}>{section}</div> : section}
      </MemoryRouter>,
    );
  });
  return container;
}

function setDraft(input: HTMLTextAreaElement, value: string) {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )!.set!;
  act(() => {
    nativeInputValueSetter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

afterEach(() => {
  document.body.innerHTML = "";
  commentsState.messages = [];
  commentsState.threads = [];
  commentsState.isLoading = false;
  commentsState.error = null;
  postComment.mockReset();
  useCommentsQuery.mockClear();
  localStorage.clear();
});

describe("IssueCommentsSection", () => {
  it("orders mixed roots chronologically and keeps replies flat under their thread", () => {
    commentsState.messages = mixedLog;
    const container = mount();

    expect(
      [...container.querySelectorAll("[data-log-root]")].map((node) =>
        node.getAttribute("data-log-root"),
      ),
    ).toEqual([
      "standalone-early",
      "unanchored-root",
      "standalone-late",
      "anchored-root",
    ]);

    expect(
      container.querySelector('[data-thread-root="standalone-early"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-thread-root="standalone-late"]'),
    ).toBeNull();
    expect(
      container
        .querySelector('[data-log-root="standalone-early"]')
        ?.textContent,
    ).toContain("Keep ordinary notes visually lighter than threads.");
    expect(
      container.querySelector('[data-log-root="standalone-early"] button'),
    ).toBeNull();

    const discussion = container.querySelector(
      '[data-thread-root="unanchored-root"]',
    );
    expect(
      [...(discussion?.querySelectorAll("[data-comment-id]") ?? [])].map(
        (node) => node.getAttribute("data-comment-id"),
      ),
    ).toEqual(["unanchored-root", "unanchored-reply"]);
    expect(discussion?.textContent).toContain(
      "Fold outdated comments, or keep them in the stream?",
    );
    expect(discussion?.textContent).toContain(
      "Same stream — dim them, keep the snippet readable.",
    );
    expect(discussion?.querySelector("button")?.textContent).toContain("Reply");

    const anchored = container.querySelector(
      '[data-thread-root="anchored-root"]',
    );
    expect(
      [...(anchored?.querySelectorAll("[data-comment-id]") ?? [])].map((node) =>
        node.getAttribute("data-comment-id"),
      ),
    ).toEqual(["anchored-root"]);
    const meta = anchored?.querySelector('[data-testid="comment-anchor-meta"]');
    expect(meta?.textContent).toContain("app/server/services/diff-fetch.ts");
    expect(meta?.textContent).toContain("line 94");
    expect(meta?.textContent).not.toMatch(/a4f91c2/);
    expect(
      anchored
        ?.querySelector("[data-anchored]")
        ?.getAttribute("data-snippet-line"),
    ).toBe("94");
    expect(
      anchored?.querySelector('[data-testid="see-in-diff"]'),
    ).not.toBeNull();
    expect(
      [...(anchored?.querySelectorAll("button") ?? [])].some((button) =>
        button.textContent?.includes("Reply"),
      ),
    ).toBe(true);
  });

  it("writes the Diff tab and thread into the search from the see-in-diff icon", () => {
    commentsState.messages = mixedLog;
    let search = "";
    const container = mount((next) => {
      search = next;
    });

    act(() => {
      container
        .querySelector('[data-testid="see-in-diff"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(search).toBe("tab=diff&thread=anchored-root");
  });

  it("opens a per-thread reply composer and posts replyTo without an anchor", () => {
    commentsState.messages = mixedLog;
    const container = mount();

    act(() => {
      container
        .querySelector('[data-thread-root="unanchored-root"] button')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const composer = container.querySelector(
      '[data-testid="comment-log-reply-composer"][data-thread-id="unanchored-root"]',
    );
    expect(composer).not.toBeNull();
    expect(
      container.querySelector(
        '[data-testid="comment-log-reply-composer"][data-thread-id="anchored-root"]',
      ),
    ).toBeNull();

    const input = composer?.querySelector("textarea");
    expect(input).not.toBeNull();
    setDraft(input!, "Will keep drafts scoped to this thread.");

    act(() => {
      composer
        ?.querySelector('button[aria-label="Send"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(postComment).toHaveBeenCalledWith({
      role: "human",
      body: "Will keep drafts scoped to this thread.",
      replyTo: "unanchored-root",
    });
    const payload = postComment.mock.calls[0]?.[0] as {
      anchor?: unknown;
    };
    expect(payload.anchor).toBeUndefined();
    expect(
      container.querySelector(
        '[data-testid="comment-log-reply-composer"][data-thread-id="unanchored-root"]',
      ),
    ).toBeNull();
  });

  it("offers Resolve after a question is converted on the story comments column", () => {
    commentsState.messages = [
      comment({
        id: "asked",
        at: "2026-09-30T03:06:00.000Z",
        role: "human",
        name: "Jared",
        kind: "question",
        body: "Why does resolving a thread post its reply in the same write?",
      }),
    ];
    commentsState.threads = [
      {
        rootId: "asked",
        kind: "review",
        state: "open",
        readyToTask: true,
        converted: {
          by: { role: "human", name: "Jared" },
          at: "2026-09-30T03:50:00.000Z",
        },
      },
    ];
    const container = mount(undefined, story());
    const card = container.querySelector('[data-thread-root="asked"]');
    expect(card?.getAttribute("data-thread-kind")).toBe("review");
    expect(card?.textContent).toContain(
      "Jared converted this question to a review comment",
    );
    expect(card?.querySelector('[data-testid="thread-resolve"]')).not.toBeNull();
    expect(card?.querySelector('[data-testid="thread-convert"]')).toBeNull();
  });

  it("offers Edit beside Quote on an editable anchored review comment on a story", () => {
    commentsState.messages = [
      comment({
        id: "editable-anchored",
        at: "2026-08-30T14:00:00.000Z",
        role: "human",
        name: "Jared",
        body: "Editable anchored review comment",
        editable: true,
        anchor: {
          path: "app/server/services/comment-edit.ts",
          side: "new",
          line: 1,
          commitSha: SHA,
        },
      }),
    ];
    const container = mount(undefined, story());
    const thread = container.querySelector('[data-thread-root="editable-anchored"]');
    expect(thread?.querySelector('[data-testid="comment-edit"]')).not.toBeNull();
    expect(thread?.querySelector('[data-testid="comment-quote"]')).not.toBeNull();
  });

  it("quotes an unanchored note as a new comment with its body and no anchor", () => {
    commentsState.messages = [standaloneEarly];
    const container = mount(undefined, story());
    const note = container.querySelector('[data-log-root="standalone-early"]');
    const quote = note?.querySelector("header")?.querySelector(
      '[data-testid="comment-quote"]',
    );
    expect(quote).not.toBeNull();
    act(() => {
      quote?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const composer = note?.querySelector('[data-testid="comment-quote-composer"]');
    expect(composer?.querySelector('[data-testid="comment-quote-label"]')?.textContent).toBe(
      "New comment",
    );
    expect(composer?.querySelector("textarea")?.value).toBe(
      "Keep ordinary notes visually lighter than threads.",
    );
    setDraft(
      composer?.querySelector("textarea") as HTMLTextAreaElement,
      "Lighter, and its own comment.",
    );
    act(() => {
      composer
        ?.querySelector('button[aria-label="Send"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(postComment).toHaveBeenCalledWith({
      role: "human",
      body: "Lighter, and its own comment.",
    });
    expect(postComment.mock.calls[0]?.[0].anchor).toBeUndefined();
  });

  it("keeps a task comment list from folding settled threads", () => {
    commentsState.messages = [
      anchored("one", "2026-08-01T12:00:00.000Z", "First resolved review."),
      anchored("two", "2026-08-01T13:00:00.000Z", "Second resolved review."),
    ];
    commentsState.threads = [view("one", "resolved"), view("two", "resolved")];
    const container = mount();
    expect(container.querySelector('[data-testid="settled-comment-run"]')).toBeNull();
    expect(container.textContent).toContain("First resolved review.");
    expect(container.textContent).toContain("Second resolved review.");
  });

  it("folds a story run of settled threads and keeps a single settled thread open", () => {
    commentsState.messages = [
      anchored("one", "2026-08-01T12:00:00.000Z", "First resolved review."),
      anchored("two", "2026-08-01T13:00:00.000Z", "Second resolved review."),
      note("between", "2026-08-01T14:00:00.000Z", "A note splits the run."),
      question("only", "2026-08-01T15:00:00.000Z", "One dismissed question stays put."),
      note("after", "2026-08-01T16:00:00.000Z", "Another note before the next run."),
      anchored("later", "2026-08-03T12:00:00.000Z", "Later resolved review."),
      question("gone", "2026-08-03T13:00:00.000Z", "Dismissed after the later review."),
    ];
    commentsState.threads = [
      view("one", "resolved"),
      view("two", "resolved"),
      view("only", "dismissed", "question"),
      view("later", "resolved"),
      view("gone", "dismissed", "question"),
    ];
    const container = mount(undefined, story());
    const runs = [...container.querySelectorAll('[data-testid="settled-comment-run"]')];
    expect(runs.map((run) => run.querySelector("button")?.textContent)).toEqual([
      "2 resolved comments",
      "2 closed comments",
    ]);
    expect(runs.every((run) => !run.hasAttribute("data-expanded"))).toBe(true);
    expect(container.textContent).not.toContain("First resolved review.");
    expect(container.textContent).toContain("A note splits the run.");
    const single = container.querySelector('[data-thread-root="only"]');
    expect(single?.closest('[data-testid="settled-comment-run"]')).toBeNull();
    expect(single?.hasAttribute("data-collapsed")).toBe(true);
    expect(container.textContent).not.toContain("One dismissed question stays put.");
    expect(container.textContent).not.toContain("Later resolved review.");

    act(() => {
      runs[0]?.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const opened = container.querySelector('[data-run-id="one"]');
    expect(opened?.hasAttribute("data-expanded")).toBe(true);
    expect(opened?.textContent).toContain("First resolved review.");
    expect(opened?.textContent).toContain("Second resolved review.");
    expect(opened?.querySelector("[data-collapsed]")).toBeNull();
    expect(container.querySelector('[data-run-id="later"]')?.hasAttribute("data-expanded")).toBe(
      false,
    );
  });

  it("hides a day marker inside a run until the section opens", () => {
    const early = "2026-08-01T12:00:00.000Z";
    const later = "2026-08-03T12:00:00.000Z";
    commentsState.messages = [
      anchored("one", early, "Same week, earlier day."),
      anchored("two", later, "Same week, later day."),
      note("after", later, "Visible after the fold."),
    ];
    commentsState.threads = [view("one", "resolved"), view("two", "resolved")];
    const container = mount(undefined, story());
    const laterLabel = commentDayLabel(later);
    const run = container.querySelector('[data-testid="settled-comment-run"]');
    expect(container.textContent).toContain(commentDayLabel(early));
    expect(run?.textContent).not.toContain(laterLabel);
    expect(container.querySelector('[data-log-root="after"]')?.textContent).toContain(
      laterLabel,
    );
    act(() => {
      container
        .querySelector('[data-testid="settled-comment-run-toggle"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(run?.textContent).toContain(laterLabel);
    expect(run?.textContent).toContain("Same week, later day.");
    expect(container.querySelector('[data-log-root="after"]')?.textContent).not.toContain(
      laterLabel,
    );
  });

  it("opens the targeted run, expands a dismissed question, and leaves the other run collapsed", () => {
    commentsState.messages = [
      anchored("keep", "2026-08-01T12:00:00.000Z", "Stay folded."),
      anchored("closed", "2026-08-01T13:00:00.000Z", "Also stay folded."),
      note("gap", "2026-08-01T14:00:00.000Z", "Open note between runs."),
      question("ask", "2026-08-02T12:00:00.000Z", "Why fold this question?"),
      question("other", "2026-08-02T13:00:00.000Z", "Leave this bar collapsed."),
    ];
    commentsState.threads = [
      view("keep", "resolved"),
      view("closed", "resolved"),
      view("ask", "dismissed", "question"),
      view("other", "dismissed", "question"),
    ];
    const intoView = vi
      .spyOn(HTMLElement.prototype, "scrollIntoView")
      .mockImplementation(() => {});
    const container = mount(undefined, story(), "/?thread=ask");
    const targeted = container.querySelector('[data-thread-root="ask"]');
    expect(container.querySelector('[data-run-id="ask"]')?.hasAttribute("data-expanded")).toBe(
      true,
    );
    expect(container.querySelector('[data-run-id="keep"]')?.hasAttribute("data-expanded")).toBe(
      false,
    );
    expect(targeted?.hasAttribute("data-collapsed")).toBe(false);
    expect(targeted?.textContent).toContain("Why fold this question?");
    const other = container.querySelector('[data-thread-root="other"]');
    expect(other?.hasAttribute("data-collapsed")).toBe(true);
    expect(
      other?.querySelector('[data-testid="thread-collapsed-bar"] [data-testid="thread-dismissed-label"]'),
    ).not.toBeNull();
    expect(intoView).toHaveBeenCalled();

    act(() => {
      container
        .querySelector('[data-run-id="ask"] [data-testid="settled-comment-run-toggle"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector('[data-run-id="ask"]')?.hasAttribute("data-expanded")).toBe(
      false,
    );
    intoView.mockRestore();
  });

  it("does not open a run while the comments list is inert", () => {
    commentsState.messages = [
      anchored("one", "2026-08-01T12:00:00.000Z", "Hidden on the diff tab."),
      anchored("two", "2026-08-01T13:00:00.000Z", "Still hidden."),
    ];
    commentsState.threads = [view("one", "resolved"), view("two", "resolved")];
    const intoView = vi
      .spyOn(HTMLElement.prototype, "scrollIntoView")
      .mockImplementation(() => {});
    const container = mount(undefined, story(), "/?tab=diff&thread=one", true);
    expect(container.querySelector('[data-testid="settled-comment-run"]')?.hasAttribute("data-expanded")).toBe(
      false,
    );
    expect(container.textContent).not.toContain("Hidden on the diff tab.");
    expect(intoView).not.toHaveBeenCalled();
    intoView.mockRestore();
  });
});

function anchored(id: string, at: string, body: string): CommentMessage {
  return comment({
    id,
    at,
    role: "story-review",
    body,
    anchor: { path: "app/notes.ts", side: "new", line: 4, commitSha: SHA },
  });
}

function note(id: string, at: string, body: string): CommentMessage {
  return comment({ id, at, role: "human", name: "Jared", body });
}

function question(id: string, at: string, body: string): CommentMessage {
  return comment({ id, at, role: "human", name: "Alex", kind: "question", body });
}

function view(
  rootId: string,
  state: "resolved" | "dismissed" | "open",
  kind: "review" | "question" = "review",
): CommentThreadView {
  return { rootId, kind, state, readyToTask: kind === "review" && state === "open" };
}
