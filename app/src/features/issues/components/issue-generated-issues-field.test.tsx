// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FIELD_LABELS } from "@server/fields";
import type { DerivedState, IssueDetail, IssueRecord } from "@server/schemas";
import { IssueGeneratedIssuesField } from "./issue-generated-issues-field";

const queryState = vi.hoisted(() => ({
  issues: [] as IssueRecord[],
  derived: {} as Record<string, DerivedState>,
}));

vi.mock("../hooks/use-issues-with-archived", () => ({
  useIssuesWithArchived: () => ({
    data: { issues: queryState.issues, derived: queryState.derived },
  }),
}));

vi.mock("./issue-link", () => ({
  IssueLink: ({
    id,
    children,
  }: {
    id: string;
    children: React.ReactNode;
  }) => <a href={`#${id}`}>{children}</a>,
}));

const t0 = "2026-07-01T00:00:00.000Z";

function idea(
  overrides: Partial<Extract<IssueDetail, { kind: "idea" }>> = {},
): Extract<IssueDetail, { kind: "idea" }> {
  return {
    id: "cap",
    kind: "idea",
    title: "Capture auth gaps",
    partOf: "platform",
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    archived: false,
    description: "",
    version: "1",
    labels: [],
    ...overrides,
  };
}

function outline(id: string, title: string, archived = false): IssueRecord {
  return {
    id,
    kind: "outline",
    title,
    partOf: "platform",
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    archived,
    sourceIdea: "cap",
    bodyVersion: 1,
  };
}

function mount(
  ui: React.ReactElement,
): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<MemoryRouter>{ui}</MemoryRouter>);
  });
  return { container, root };
}

afterEach(() => {
  queryState.issues = [];
  queryState.derived = {};
  document.body.replaceChildren();
});

describe("IssueGeneratedIssuesField", () => {
  it("lists generated outlines in derived order when generatedOutlines is non-empty", () => {
    queryState.issues = [
      outline("o-second", "Second pass"),
      outline("o-first", "First pass"),
    ];
    queryState.derived = {
      cap: {
        blocked: false,
        generatedOutlines: ["o-first", "o-second"],
        planRoots: ["story-ship"],
      },
    };

    const { container } = mount(<IssueGeneratedIssuesField issue={idea()} />);
    expect(container.textContent).toContain(FIELD_LABELS.generatedOutline);
    expect(container.textContent).not.toContain(FIELD_LABELS.generatedIssues);
    const links = container.querySelectorAll("a");
    expect(links[0]?.textContent).toBe("First pass");
    expect(links[1]?.textContent).toBe("Second pass");
  });

});
