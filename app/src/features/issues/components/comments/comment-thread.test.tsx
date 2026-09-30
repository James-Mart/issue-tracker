// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommentMessage } from "@server/schemas";
import type { CommentThread as CommentThreadData } from "../../lib/comment-threads";
import { CommentThread } from "./comment-thread";

const SHA = "a4f91c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b";

const FILE_CONTENTS = Array.from(
  { length: 100 },
  (_, index) => `line ${index + 1}`,
).join("\n");

vi.mock("../../api/queries", () => ({
  useIssueChangeFileQuery: () => ({ data: FILE_CONTENTS }),
  useIssuesQuery: () => ({
    data: {
      issues: [
        {
          id: "task-a",
          kind: "task",
          title: "Tighten review API errors",
          partOf: "story-threads",
          status: "todo",
        },
      ],
    },
  }),
}));

function comment(
  overrides: Partial<CommentMessage> &
    Pick<CommentMessage, "id" | "at" | "body" | "role">,
): CommentMessage {
  return { ...overrides };
}

const currentThread: CommentThreadData = {
  kind: "review",
  state: "open",
  readyToTask: true,
  root: comment({
    id: "current-root",
    at: "2026-08-30T14:22:00.000Z",
    role: "story-review",
    body: "Scope drafts per thread so Diff and Overview stay isolated.",
    anchor: {
      path: "app/server/services/diff-fetch.ts",
      side: "new",
      line: 94,
      commitSha: SHA,
    },
  }),
  replies: [
    comment({
      id: "current-reply",
      at: "2026-08-30T15:04:00.000Z",
      role: "human",
      name: "Jared",
      replyTo: "current-root",
      body: "Agreed. Per-thread draft keys, flat replies.",
    }),
  ],
};

const outdatedThread: CommentThreadData = {
  kind: "review",
  state: "open",
  readyToTask: true,
  root: comment({
    id: "outdated-root",
    at: "2026-08-29T09:15:00.000Z",
    role: "story-review",
    body: "Run assertCommitReachable before git show.",
    outdated: true,
    anchor: {
      path: "app/server/services/diff-fetch.ts",
      side: "old",
      line: 90,
      startLine: 88,
      commitSha: SHA,
    },
  }),
  replies: [],
};

function mount(
  threads: CommentThreadData[],
  onSeeInDiff?: (threadId: string) => void,
): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <>
        {threads.map((thread) => (
          <CommentThread
            key={thread.root.id}
            thread={thread}
            issueId="task-threads"
            showAnchorContext
            onSeeInDiff={
              onSeeInDiff
                ? () => onSeeInDiff(thread.root.id)
                : undefined
            }
            onReply={vi.fn()}
          />
        ))}
      </>,
    );
  });
  return container;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("CommentThread", () => {
  it("renders a current agent thread with a human reply and an outdated thread", () => {
    const container = mount([currentThread, outdatedThread]);

    const current = container.querySelector('[data-thread-root="current-root"]');
    const comments = current?.querySelectorAll("[data-comment-id]");
    expect(comments).toHaveLength(2);
    expect(comments?.[0]?.getAttribute("data-comment-id")).toBe("current-root");
    expect(comments?.[1]?.getAttribute("data-comment-id")).toBe("current-reply");
    expect(comments?.[0]?.textContent).toContain(
      "Scope drafts per thread so Diff and Overview stay isolated.",
    );
    expect(comments?.[1]?.textContent).toContain(
      "Agreed. Per-thread draft keys, flat replies.",
    );

    const agentHeader = comments?.[0]?.querySelector("header");
    expect(agentHeader?.querySelector("svg")).not.toBeNull();
    expect(agentHeader?.textContent).toContain("Story review");
    expect(agentHeader?.textContent).not.toContain("Jared");
    expect(agentHeader?.textContent).not.toContain("story-review");

    const humanHeader = comments?.[1]?.querySelector("header");
    expect(humanHeader?.querySelector("svg")).toBeNull();
    expect(humanHeader?.textContent).toContain("Jared");
    expect(humanHeader?.querySelector("time")?.getAttribute("dateTime")).toBe(
      "2026-08-30T15:04:00.000Z",
    );

    const outdated = container.querySelector('[data-thread-root="outdated-root"]');
    expect(outdated?.hasAttribute("data-outdated")).toBe(true);
    expect(outdated?.textContent).toMatch(/outdated/i);
    expect(outdated?.className).toContain("opacity-70");
    expect(outdated?.textContent).toContain(
      "Run assertCommitReachable before git show.",
    );

    const currentMeta = current?.querySelector(
      '[data-testid="comment-anchor-meta"]',
    );
    const path = currentMeta?.querySelector("span.min-w-0");
    expect(path?.className).toContain("[direction:rtl]");
    expect(path?.className).toContain("shell:[direction:ltr]");
    expect(currentMeta?.textContent).toContain(
      "app/server/services/diff-fetch.ts",
    );
    expect(currentMeta?.textContent).toContain("line 94");
    expect(currentMeta?.textContent).not.toMatch(/a4f91c2/);
    expect(
      current?.querySelector('[data-testid="see-in-diff"]'),
    ).toBeNull();

    const currentSnippet = current?.querySelector(
      '[data-testid="comment-anchor-snippet"]',
    );
    expect(
      currentSnippet
        ?.querySelector("[data-anchored]")
        ?.getAttribute("data-snippet-line"),
    ).toBe("94");
    expect(currentSnippet?.textContent).toContain("line 94");

    const outdatedMeta = outdated?.querySelector(
      '[data-testid="comment-anchor-meta"]',
    );
    expect(outdatedMeta?.textContent).toContain("lines 88-90");
    expect(outdatedMeta?.textContent).toMatch(/outdated/i);
    const outdatedMarked = [
      ...(outdated?.querySelectorAll(
        '[data-testid="comment-anchor-snippet"] [data-anchored]',
      ) ?? []),
    ].map((node) => node.getAttribute("data-snippet-line"));
    expect(outdatedMarked).toEqual(["88", "89", "90"]);
  });

  it("invokes see-in-diff from the icon-only affordance", () => {
    const onSeeInDiff = vi.fn();
    const container = mount([currentThread], onSeeInDiff);
    const button = container.querySelector(
      '[data-testid="see-in-diff"]',
    );
    expect(button?.textContent).toBe("");
    expect(button?.getAttribute("aria-label")).toBe(
      "See this comment in the diff",
    );

    act(() => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onSeeInDiff).toHaveBeenCalledWith("current-root");
  });

  it("drops path and line on an inline thread and offers Resolve", () => {
    const onResolve = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <CommentThread
          thread={currentThread}
          inline
          onReply={vi.fn()}
          onResolve={onResolve}
        />,
      );
    });

    const thread = container.querySelector('[data-thread-root="current-root"]');
    expect(thread?.getAttribute("data-thread-state")).toBe("open");
    expect(thread?.querySelector('[data-testid="comment-anchor-meta"]')).toBeNull();
    expect(thread?.textContent).not.toContain("diff-fetch.ts");
    expect(thread?.textContent).not.toContain("line 94");
    expect(thread?.textContent).toContain(
      "Scope drafts per thread so Diff and Overview stay isolated.",
    );

    const resolve = thread?.querySelector('[data-testid="thread-resolve"]');
    act(() => {
      resolve?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onResolve).toHaveBeenCalledOnce();
  });

  it("collapses a resolved inline thread to a bar that expands and unresolves", () => {
    const onUnresolve = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const resolved: CommentThreadData = { ...currentThread, state: "resolved" };
    act(() => {
      root.render(
        <CommentThread
          thread={resolved}
          inline
          onReply={vi.fn()}
          onUnresolve={onUnresolve}
        />,
      );
    });

    const thread = container.querySelector('[data-thread-root="current-root"]');
    expect(thread?.hasAttribute("data-collapsed")).toBe(true);
    expect(thread?.textContent).toContain("2 comments");
    expect(thread?.textContent).toMatch(/resolved/i);
    expect(thread?.textContent).not.toMatch(/outdated/i);
    expect(thread?.textContent).not.toContain(
      "Scope drafts per thread so Diff and Overview stay isolated.",
    );

    const expand = thread?.querySelector('[aria-label="Expand thread"]');
    act(() => {
      expand?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(thread?.hasAttribute("data-collapsed")).toBe(false);
    expect(thread?.textContent).toContain(
      "Scope drafts per thread so Diff and Overview stay isolated.",
    );
    expect(thread?.textContent).not.toContain("diff-fetch.ts");

    const unresolve = thread?.querySelector('[data-testid="thread-unresolve"]');
    act(() => {
      unresolve?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onUnresolve).toHaveBeenCalledOnce();
  });

  it("collapses an outdated thread to a line bar that expands to its snippet", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <CommentThread
          thread={outdatedThread}
          issueId="task-threads"
          inline
          showAnchorContext
          collapse="outdated"
          onReply={vi.fn()}
          onResolve={vi.fn()}
        />,
      );
    });

    const thread = container.querySelector('[data-thread-root="outdated-root"]');
    const bar = thread?.querySelector('[data-testid="thread-collapsed-bar"]');
    expect(thread?.hasAttribute("data-collapsed")).toBe(true);
    expect(thread?.className).not.toContain("opacity-70");
    expect(bar?.textContent).toBe("lines 88-90 · 1 comment");
    expect(thread?.querySelector('[data-testid="thread-unresolve"]')).toBeNull();
    expect(thread?.querySelector('[data-testid="comment-anchor-meta"]')).toBeNull();
    expect(thread?.textContent).not.toContain("Run assertCommitReachable before git show.");

    act(() => {
      thread
        ?.querySelector('[aria-label="Expand thread"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(thread?.hasAttribute("data-collapsed")).toBe(false);
    expect(thread?.querySelector('[data-testid="comment-anchor-snippet"]')).not.toBeNull();
    expect(thread?.textContent).toContain("Run assertCommitReachable before git show.");
    expect(thread?.querySelector('[data-testid="thread-resolve"]')).not.toBeNull();
  });

  it("renders a linked Task chip on inline threads", () => {
    const linked: CommentThreadData = {
      ...currentThread,
      linkedTaskId: "task-a",
      readyToTask: false,
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <MemoryRouter initialEntries={["/projects/issue-tracker/issues/story-threads"]}>
          <CommentThread thread={linked} inline onReply={vi.fn()} />
        </MemoryRouter>,
      );
    });

    const chip = container.querySelector('[data-testid="thread-linked-task"]');
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toContain("Tighten review API errors");
    expect(
      container.querySelector('[data-thread-root="current-root"]')?.hasAttribute(
        "data-ready-to-task",
      ),
    ).toBe(false);
    expect(chip?.parentElement?.className).toContain("w-full");
  });

  it("puts the Task chip on its own row beside jump-to-Diff", () => {
    const linked: CommentThreadData = {
      ...currentThread,
      linkedTaskId: "task-a",
      readyToTask: false,
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <MemoryRouter initialEntries={["/projects/issue-tracker/issues/story-threads"]}>
          <CommentThread
            thread={linked}
            showAnchorContext
            issueId="task-threads"
            onSeeInDiff={vi.fn()}
            onReply={vi.fn()}
          />
        </MemoryRouter>,
      );
    });

    const meta = container.querySelector('[data-testid="comment-anchor-meta"]');
    const chip = container.querySelector('[data-testid="thread-linked-task"]');
    const jump = container.querySelector('[data-testid="see-in-diff"]');
    expect(meta?.contains(jump)).toBe(true);
    expect(meta?.contains(chip)).toBe(false);
    expect(chip?.parentElement?.className).toContain("w-full");
  });

  it("collapses a resolved conversation thread and keeps its anchor header", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const resolved: CommentThreadData = { ...currentThread, state: "resolved" };
    act(() => {
      root.render(
        <CommentThread
          thread={resolved}
          collapse="resolved"
          showAnchorContext
          issueId="task-threads"
          onSeeInDiff={vi.fn()}
          onReply={vi.fn()}
          onUnresolve={vi.fn()}
        />,
      );
    });

    const thread = container.querySelector('[data-thread-root="current-root"]');
    expect(thread?.hasAttribute("data-collapsed")).toBe(true);
    expect(thread?.textContent).toContain("diff-fetch.ts");
    expect(thread?.textContent).toContain("line 94");
    expect(thread?.querySelector('[data-testid="see-in-diff"]')).not.toBeNull();
    expect(thread?.textContent).not.toContain(
      "Scope drafts per thread so Diff and Overview stay isolated.",
    );
  });

  it("labels a question, hides the Task chip, and dismisses to a collapsed bar", () => {
    const onDismiss = vi.fn();
    const onReopen = vi.fn();
    const question: CommentThreadData = {
      ...currentThread,
      kind: "question",
      readyToTask: false,
      linkedTaskId: "task-a",
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <CommentThread
          thread={question}
          inline
          onReply={vi.fn()}
          onResolve={vi.fn()}
          onDismiss={onDismiss}
          onReopen={onReopen}
        />,
      );
    });

    const thread = container.querySelector('[data-thread-root="current-root"]');
    expect(thread?.getAttribute("data-thread-kind")).toBe("question");
    expect(thread?.hasAttribute("data-ready-to-task")).toBe(false);
    expect(thread?.textContent).toContain("Question");
    expect(thread?.querySelector('[data-testid="thread-linked-task"]')).toBeNull();
    expect(thread?.querySelector('[data-testid="thread-resolve"]')).toBeNull();

    act(() => {
      thread
        ?.querySelector('[data-testid="thread-dismiss"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onDismiss).toHaveBeenCalledOnce();

    act(() => {
      root.render(
        <CommentThread
          thread={{ ...question, state: "dismissed" }}
          inline
          onReply={vi.fn()}
          onDismiss={onDismiss}
          onReopen={onReopen}
        />,
      );
    });
    const collapsed = container.querySelector('[data-thread-root="current-root"]');
    expect(collapsed?.hasAttribute("data-collapsed")).toBe(true);
    expect(collapsed?.textContent).toContain("Dismissed");
    expect(collapsed?.textContent).not.toContain("Question");
    act(() => {
      collapsed
        ?.querySelector('[data-testid="thread-reopen"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onReopen).toHaveBeenCalledOnce();
  });

  it("offers convert on an open question and shows the system event once converted", () => {
    const onConvert = vi.fn();
    const question: CommentThreadData = {
      ...currentThread,
      kind: "question",
      readyToTask: false,
      replies: [
        {
          id: "answer",
          at: "2026-09-29T14:20:00.000Z",
          role: "agent",
          name: "Researcher",
          replyTo: "current-root",
          body: "The label stays on the root.",
        },
      ],
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <MemoryRouter>
          <CommentThread
            thread={question}
            onReply={vi.fn()}
            onDismiss={vi.fn()}
            onConvert={onConvert}
            onResolve={vi.fn()}
          />
        </MemoryRouter>,
      );
    });

    const open = container.querySelector('[data-thread-root="current-root"]');
    expect(open?.getAttribute("data-thread-kind")).toBe("question");
    expect(open?.textContent).toContain("Question");
    expect(open?.querySelector('[data-testid="thread-resolve"]')).toBeNull();
    act(() => {
      open
        ?.querySelector('[data-testid="thread-convert"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onConvert).toHaveBeenCalledOnce();

    const converted: CommentThreadData = {
      ...question,
      kind: "review",
      readyToTask: true,
      linkedTaskId: "task-a",
      converted: {
        by: { role: "human", name: "Jared" },
        at: "2026-09-29T14:50:00.000Z",
      },
    };
    act(() => {
      root.render(
        <MemoryRouter>
          <CommentThread
            thread={converted}
            onReply={vi.fn()}
            onResolve={vi.fn()}
            onConvert={onConvert}
          />
        </MemoryRouter>,
      );
    });
    const review = container.querySelector('[data-thread-root="current-root"]');
    expect(review?.getAttribute("data-thread-kind")).toBe("review");
    expect(review?.hasAttribute("data-ready-to-task")).toBe(true);
    expect(review?.textContent).toContain("The label stays on the root.");
    expect(review?.textContent).toContain(
      "Jared converted this question to a review comment",
    );
    expect(review?.textContent).not.toContain("Question");
    expect(review?.querySelector('[data-testid="thread-convert"]')).toBeNull();
    expect(review?.querySelector('[data-testid="thread-dismiss"]')).toBeNull();
    expect(review?.querySelector('[data-testid="thread-resolve"]')).not.toBeNull();
    expect(review?.querySelector('[data-testid="thread-linked-task"]')).not.toBeNull();
    expect(review?.querySelector('[data-testid="thread-converted"]')).not.toBeNull();
  });
});
