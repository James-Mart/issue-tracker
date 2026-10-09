// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommentMessage } from "@server/schemas";
import type { CommentThread as CommentThreadData } from "../../lib/comment-threads";
import { CommentThread } from "./comment-thread";
import { DeliverableMessage } from "./comment-delivery";
import { commentHeaderLabels } from "./message";

vi.mock("../../api/queries", () => ({
  useIssueChangeFileQuery: () => ({ data: "" }),
  useIssuesQuery: () => ({ data: { issues: [] } }),
}));

const URL = "https://github.com/acme/widgets/pull/7#issuecomment-1";

function message(source?: CommentMessage["source"]): CommentMessage {
  return {
    id: "c1",
    at: "2024-06-01T00:00:00.000Z",
    role: "human",
    name: "ada",
    body: "please rename this",
    ...(source ? { source } : {}),
  };
}

function mount(node: ReactNode): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return container;
}

function expectGitHubLink(container: HTMLElement): HTMLAnchorElement {
  const link = container.querySelector('[data-testid="comment-github-link"]');
  expect(link).toBeInstanceOf(HTMLAnchorElement);
  const anchor = link as HTMLAnchorElement;
  expect(anchor.textContent?.trim()).toBe("");
  expect(anchor.getAttribute("aria-label")).toBe("View on GitHub");
  expect(anchor.getAttribute("href")).toBe(URL);
  expect(anchor.target).toBe("_blank");
  expect(anchor.rel).toBe("noreferrer");
  expect(anchor.className).toContain("text-primary");
  expect(anchor.querySelector('[data-testid="comment-github-icon"]')).not.toBeNull();
  return anchor;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("GitHub source link", () => {
  it("omits the Human role badge on tracker human comments", () => {
    const container = mount(<DeliverableMessage message={message()} />);
    expect(container.textContent).toContain("ada");
    expect(container.querySelector('[data-testid="comment-role-badge"]')).toBeNull();
  });

  it("shows a GitHub icon link in a plain note header", () => {
    const container = mount(
      <DeliverableMessage
        message={message({ kind: "github", id: "IC_1", url: URL })}
      />,
    );
    expectGitHubLink(container);
  });

  it("shows a GitHub icon link in a thread header", () => {
    const thread: CommentThreadData = {
      kind: "review",
      state: "open",
      readyToTask: true,
      root: message({ kind: "github", id: "IC_1", url: URL }),
      replies: [],
    };
    const container = mount(<CommentThread thread={thread} issueId="ship" />);
    expectGitHubLink(container);
  });

  it("omits the link when the comment has no GitHub source", () => {
    const container = mount(<DeliverableMessage message={message()} />);
    expect(container.querySelector('[data-testid="comment-github-link"]')).toBeNull();
  });

  it("shows a GitHub bot as the Bot icon and the login", () => {
    const source = { kind: "github" as const, id: "IC_bot", url: URL };
    const bot = {
      ...message(source),
      role: "github-bot",
      name: "dependabot[bot]",
      body: "coverage dropped",
    };
    expect(commentHeaderLabels(bot.role, bot.name)).toEqual({
      author: "dependabot[bot]",
      roleBadge: "Bot",
    });

    const note = mount(<DeliverableMessage message={bot} />);
    expect(note.querySelector('[data-testid="comment-bot-icon"]')).not.toBeNull();
    expect(note.textContent).toContain("dependabot[bot]");
    expect(note.querySelector('[data-testid="comment-role-badge"]')?.textContent).toBe("Bot");
    expectGitHubLink(note);

    const thread: CommentThreadData = {
      kind: "review",
      state: "open",
      readyToTask: true,
      root: {
        ...bot,
        id: "thread-bot",
        anchor: {
          path: "src/app.ts",
          side: "new",
          line: 12,
          commitSha: "a".repeat(40),
        },
      },
      replies: [],
    };
    const threaded = mount(<CommentThread thread={thread} issueId="ship" />);
    expect(threaded.querySelector('[data-testid="comment-bot-icon"]')).not.toBeNull();
    expect(threaded.textContent).toContain("dependabot[bot]");
    expect(threaded.querySelector('[data-testid="comment-role-badge"]')?.textContent).toBe(
      "Bot",
    );
  });
});
