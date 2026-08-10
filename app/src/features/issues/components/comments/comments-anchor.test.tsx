// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IssueDetail } from "@server/schemas";
import { CommentsAnchor, CommentsAnchorLink } from "./comments-anchor";

const useCommentsQuery = vi.hoisted(() =>
  vi.fn(() => ({ data: { messages: [] as { at: string; role: string; body: string }[] } })),
);

vi.mock("../../api/queries", () => ({
  useCommentsQuery,
}));

const t0 = "2026-07-01T00:00:00.000Z";

function epic(
  overrides: Partial<Extract<IssueDetail, { kind: "epic" }>> = {},
): IssueDetail {
  return {
    id: "e1",
    kind: "epic",
    title: "Epic",
    partOf: "p",
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    needsAttention: false,
    attentionReason: null,
    blockedBy: [],
    archived: false,
    description: "",
    labels: [],
    ...overrides,
  };
}

function idea(): IssueDetail {
  return {
    id: "i1",
    kind: "idea",
    title: "Idea",
    partOf: "p",
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    blockedBy: [],
    archived: false,
    description: "",
    labels: [],
  };
}

function project(): IssueDetail {
  return {
    id: "p",
    kind: "project",
    title: "Project",
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    workspace: "/tmp",
    mergePolicy: "rebase",
    labels: [],
    supportingDocs: {},
    inspirationApps: [],
    description: "",
  };
}

function mountAnchor(issue: IssueDetail): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => {
    root.render(<CommentsAnchor issue={issue} />);
  });
  return container;
}

function mount(issue: IssueDetail, commentCount: number): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => {
    root.render(<CommentsAnchorLink issue={issue} commentCount={commentCount} />);
  });
  return container;
}

afterEach(() => {
  document.body.innerHTML = "";
  useCommentsQuery.mockClear();
});

describe("CommentsAnchor", () => {
  it("does not fetch comments for a Project", () => {
    mountAnchor(project());
    expect(useCommentsQuery).not.toHaveBeenCalled();
  });
});

describe("CommentsAnchorLink", () => {
  it("renders nothing for a Project", () => {
    const container = mount(project(), 2);
    expect(container.querySelector("a")).toBeNull();
  });

  it("renders the quiet form with a comment count", () => {
    const container = mount(epic(), 3);
    const link = container.querySelector('a[href="#comments"]');
    expect(link?.textContent).toContain("3");
    expect(link?.className).toContain("text-muted-foreground");
    expect(link?.className).not.toContain("warning");
  });

  it("renders the quiet form when there are zero comments", () => {
    const container = mount(epic(), 0);
    const link = container.querySelector('a[href="#comments"]');
    expect(link?.textContent).toContain("0");
    expect(link?.className).toContain("text-muted-foreground");
  });

  it("renders the flagged form when needsAttention is set", () => {
    const container = mount(
      epic({ needsAttention: true, attentionReason: "blocked" }),
      1,
    );
    const link = container.querySelector('a[href="#comments"]');
    expect(link?.className).toContain("warning");
    expect(link?.getAttribute("title")).toContain("blocked");
  });

  it("renders only the quiet form on an Idea", () => {
    const container = mount(idea(), 2);
    const link = container.querySelector('a[href="#comments"]');
    expect(link?.className).toContain("text-muted-foreground");
    expect(link?.className).not.toContain("warning");
  });
});
