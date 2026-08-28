// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FIELD_LABELS } from "@server/fields";
import type { IssueDetail } from "@server/schemas";
import { IssueMetaPanel } from "./issue-meta-panel";

vi.mock("./issue-part-of-field", () => ({
  IssuePartOfField: () => <span data-testid="parent-field" />,
}));
vi.mock("./issue-source-idea-field", () => ({
  IssueSourceIdeaField: () => null,
}));
vi.mock("./issue-assignee-field", () => ({
  IssueAssigneeField: () => null,
}));
vi.mock("./issue-assignment-labels-field", () => ({
  IssueAssignmentLabelsField: () => null,
}));
vi.mock("./issue-stakeholder-field", () => ({
  IssueStakeholderField: () => null,
}));
vi.mock("./issue-generated-issues-field", () => ({
  IssueGeneratedIssuesField: () => null,
}));
vi.mock("./issue-attention-fields", () => ({
  IssueNeedsAttentionField: () => null,
  IssueAttentionReasonField: () => null,
}));
vi.mock("./git-stack-panel", () => ({
  GitStackPanel: () => null,
}));

const t0 = "2026-08-10T12:00:00.000Z";

function epicIssue(): Extract<IssueDetail, { kind: "epic" }> {
  return {
    kind: "epic",
    id: "auth-epic",
    title: "Add authentication",
    partOf: "platform",
    order: 0,
    archived: false,
    needsAttention: false,
    createdAt: t0,
    updatedAt: t0,
    description: "",
    labels: [],
    version: "v1",
    blockedBy: [],
    attentionReason: null,
  };
}

function storyIssue(): Extract<IssueDetail, { kind: "story" }> {
  return {
    kind: "story",
    id: "login-story",
    title: "Login form",
    partOf: "auth-epic",
    order: 0,
    archived: false,
    needsAttention: false,
    createdAt: t0,
    updatedAt: t0,
    description: "",
    labels: [],
    version: "v1",
    merged: false,
    reviewedTasks: [],
    attentionReason: null,
  };
}

function taskIssue(): Extract<IssueDetail, { kind: "task" }> {
  return {
    kind: "task",
    id: "wire-form",
    title: "Wire the form",
    partOf: "login-story",
    order: 0,
    archived: false,
    needsAttention: false,
    status: "todo",
    createdAt: t0,
    updatedAt: t0,
    description: "",
    labels: [],
    version: "v1",
    attentionReason: null,
  };
}

function mount(
  ui: React.ReactElement,
): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  return { container, root };
}

afterEach(() => {
  document.body.innerHTML = "";
});

function parentRowLabel(container: HTMLElement): string | undefined {
  const field = container.querySelector("[data-testid=parent-field]");
  const row = field?.closest("div.grid");
  return row?.querySelector("span")?.textContent ?? undefined;
}

describe("IssueMetaPanel parent row", () => {
  it("keeps the shared Part of label for other surfaces", () => {
    expect(FIELD_LABELS.partOf).toBe("Part of");
  });

  it.each([
    ["epic", epicIssue()],
    ["story", storyIssue()],
    ["task", taskIssue()],
  ] as const)("labels the %s Overview parent row Parent issue", (_kind, issue) => {
    const { container } = mount(<IssueMetaPanel issue={issue} />);

    expect(parentRowLabel(container)).toBe("Parent issue");
    expect(container.textContent).not.toContain("Part of");
  });
});
