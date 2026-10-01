// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";
import type { CommentThread as CommentThreadData } from "@/features/issues/lib/comment-threads";
import { ReviewThread } from "./review-thread";

function thread(editable: boolean): CommentThreadData {
  return {
    kind: "review",
    state: "open",
    readyToTask: true,
    root: {
      id: "c1",
      at: "2026-09-28T16:43:00.000Z",
      role: "story-review",
      body: "Name the refusal in the response.",
      editable,
    },
    replies: [
      {
        id: "c2",
        at: "2026-09-28T16:50:00.000Z",
        role: "human",
        name: "Jared",
        replyTo: "c1",
        body: "Will do.",
        editable,
      },
    ],
  };
}

let root: Root | undefined;

function mount(editable: boolean): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  act(() => {
    root!.render(
      <QueryClientProvider client={client}>
        <ReviewThread thread={thread(editable)} storyId="story-1" />
      </QueryClientProvider>,
    );
  });
  return container;
}

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

describe("ReviewThread edit", () => {
  it("offers Edit on each editable comment in the shared card", () => {
    const card = mount(true);
    const buttons = card.querySelectorAll('[data-testid="comment-edit"]');
    expect(buttons).toHaveLength(2);
    expect(card.querySelector('[data-comment-id="c1"]')?.textContent).toContain("Edit");
    expect(card.querySelector('[data-comment-id="c2"]')?.textContent).toContain("Edit");
  });

  it("omits Edit when the comment is not editable", () => {
    const card = mount(false);
    expect(card.querySelector('[data-testid="comment-edit"]')).toBeNull();
  });
});
