// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DerivedState, IssueDetail, IssueRecord } from "@server/schemas";
import { resetAppendTargetDraftStore } from "../store/use-append-target-draft-store";
import { IssueAppendToField } from "./issue-append-to-field";

const go = vi.fn();

const t0 = "2026-08-10T12:00:00.000Z";

const project: IssueRecord = {
  kind: "project",
  id: "platform",
  title: "Platform",
  trunk: "main",
  mergePolicy: "manual",
  maxImplementingRuns: 1,
  order: 0,
  createdAt: t0,
  updatedAt: t0,
};

const epic: IssueRecord = {
  kind: "epic",
  id: "auth-epic",
  title: "Auth",
  partOf: "platform",
  blockedBy: [],
  order: 0,
  archived: false,
  needsAttention: false,
  attentionReason: null,
  createdAt: t0,
  updatedAt: t0,
};

const openStory: IssueRecord = {
  kind: "story",
  id: "open-story",
  title: "OAuth callback hardening",
  partOf: "auth-epic",
  order: 0,
  archived: false,
  needsAttention: false,
  attentionReason: null,
  createdAt: t0,
  updatedAt: t0,
  merged: false,
  reviewedTasks: [],
};

vi.mock("./issue-link", () => ({
  IssueLink: ({
    id,
    children,
  }: {
    id: string;
    children: React.ReactNode;
  }) => (
    <a
      href={`#${id}`}
      onClick={(event) => {
        event.preventDefault();
        go(id);
      }}
    >
      {children}
    </a>
  ),
  useIssueLinkNavigate: () => ({
    go,
    hrefFor: (id: string) => `#${id}`,
    missingIds: [],
    failedIds: new Set<string>(),
    accept: () => {},
    reject: () => {},
  }),
  useBoundNavigate: () => ({
    go,
    hrefFor: (id: string) => `#${id}`,
    byId: new Map(),
    missingIds: [],
    failedIds: new Set<string>(),
    accept: () => {},
    reject: () => {},
    listReady: true,
    messageFor: () => undefined,
  }),
}));

vi.mock("../api/mutations", () => ({
  useUpdateIssue: () => ({ mutateAsync: vi.fn() }),
}));

const queryState: {
  issues: IssueRecord[];
  derived: Record<string, DerivedState>;
} = {
  issues: [project, epic, openStory],
  derived: {},
};

vi.mock("../api/queries", () => ({
  useIssuesQuery: () => ({
    data: {
      issues: queryState.issues,
      derived: queryState.derived,
    },
  }),
}));

function idea(appendTo: string): Extract<IssueDetail, { kind: "idea" }> {
  return {
    kind: "idea",
    id: "capture",
    title: "Capture",
    partOf: "platform",
    order: 0,
    archived: false,
    createdAt: t0,
    updatedAt: t0,
    description: "",
    version: "v1",
    appendTo,
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

function editButton(container: HTMLElement): HTMLButtonElement {
  return container.querySelector(
    '[aria-label="Edit append target"]',
  ) as HTMLButtonElement;
}

function clearButton(container: HTMLElement): HTMLButtonElement {
  return container.querySelector(
    '[aria-label="Clear append target"]',
  ) as HTMLButtonElement;
}

afterEach(() => {
  document.body.innerHTML = "";
  go.mockReset();
  resetAppendTargetDraftStore();
  queryState.derived = {};
});

describe("IssueAppendToField", () => {
  it("is read-only for a planned append Idea with link and navigate only", () => {
    queryState.derived = {
      capture: { blocked: false, ideaStatus: "planned" },
    };

    const { container } = mount(
      <IssueAppendToField issue={idea("open-story")} />,
    );

    expect(container.querySelector("a")?.textContent).toBe(
      "OAuth callback hardening",
    );
    expect(container.querySelector('[title="Open open-story"]')).toBeTruthy();
    expect(editButton(container)).toBeNull();
    expect(clearButton(container)).toBeNull();
  });
});
