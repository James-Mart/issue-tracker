// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
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
}));

function comment(
  overrides: Partial<CommentMessage> &
    Pick<CommentMessage, "id" | "at" | "body" | "role">,
): CommentMessage {
  return { ...overrides };
}

const currentThread: CommentThreadData = {
  root: comment({
    id: "current-root",
    at: "2026-08-30T14:22:00.000Z",
    role: "code-quality-validator",
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
  root: comment({
    id: "outdated-root",
    at: "2026-08-29T09:15:00.000Z",
    role: "code-quality-validator",
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
    expect(agentHeader?.textContent).toContain("Code-quality validator");
    expect(agentHeader?.textContent).not.toContain("Jared");
    expect(agentHeader?.textContent).not.toContain("code-quality-validator");

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
});
