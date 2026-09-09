// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FIELD_LABELS } from "@server/fields";
import type { DerivedState, IssueRecord } from "@server/schemas";
import { IssueGeneratedIssuesField } from "./issue-generated-issues-field";

const go = vi.fn();

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
  }),
}));

const t0 = "2026-08-10T12:00:00.000Z";

const idea: Extract<IssueRecord, { kind: "idea" }> = {
  kind: "idea",
  id: "capture",
  title: "Better capture flow",
  partOf: "platform",
  order: 0,
  archived: false,
  createdAt: t0,
  updatedAt: t0,
};

const appendIdea: Extract<IssueRecord, { kind: "idea" }> = {
  ...idea,
  id: "idea-pr",
  title: "PR feedback — redirect allowlist",
  appendTo: "oauth-hardening",
};

function project(): IssueRecord {
  return {
    kind: "project",
    id: "platform",
    title: "Platform",
    mergePolicy: "manual",
    order: 0,
    createdAt: t0,
    updatedAt: t0,
  };
}

function epic(): IssueRecord {
  return {
    kind: "epic",
    id: "provenance-epic",
    title: "Issue provenance",
    partOf: "platform",
    order: 0,
    archived: false,
    needsAttention: false,
    createdAt: t0,
    updatedAt: t0,
    sourceIdea: "capture",
  };
}

function story(
  id: string,
  title: string,
  extras: Partial<Extract<IssueRecord, { kind: "story" }>> = {},
): IssueRecord {
  return {
    kind: "story",
    id,
    title,
    partOf: "platform",
    order: extras.order ?? 1,
    archived: false,
    needsAttention: false,
    createdAt: t0,
    updatedAt: t0,
    sourceIdea: extras.sourceIdea,
    merged: false,
    ...extras,
  };
}

function task(
  id: string,
  title: string,
  extras: Partial<Extract<IssueRecord, { kind: "task" }>> = {},
): Extract<IssueRecord, { kind: "task" }> {
  return {
    kind: "task",
    id,
    title,
    partOf: extras.partOf ?? "oauth-hardening",
    order: extras.order ?? 0,
    createdAt: t0,
    updatedAt: t0,
    status: extras.status ?? "todo",
    commits: extras.commits ?? [],
    ...extras,
  };
}

const nonAppendIssues: IssueRecord[] = [
  project(),
  idea,
  epic(),
  story("detail-rows", "Surface detail rows", { sourceIdea: "capture" }),
];

const appendIssues: IssueRecord[] = [
  project(),
  appendIdea,
  story("oauth-hardening", "OAuth callback hardening", { order: 0 }),
  task("tighten-allowlist", "Tighten redirect allowlist per review", {
    order: 2,
    status: "done",
    sourceIdea: "idea-pr",
    appended: true,
    commits: ["e7f8a9b000000000000000000000000000000000"],
  }),
  task("validate-state", "Validate state parameter on callback", {
    order: 3,
    sourceIdea: "idea-pr",
    appended: true,
  }),
  task("existing-task", "Wire the callback", { order: 0, status: "done" }),
];

const queryState: {
  issues: IssueRecord[];
  derived: Record<string, DerivedState>;
} = {
  issues: nonAppendIssues,
  derived: {
    capture: { blocked: false, planRoots: ["provenance-epic", "detail-rows"] },
  },
};

vi.mock("../api/queries", () => ({
  useIssuesQuery: () => ({
    data: {
      issues: queryState.issues,
      derived: queryState.derived,
    },
  }),
}));

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
  go.mockReset();
  queryState.issues = nonAppendIssues;
  queryState.derived = {
    capture: { blocked: false, planRoots: ["provenance-epic", "detail-rows"] },
  };
});

describe("IssueGeneratedIssuesField", () => {
  it("renders a link for each plan root with its title", () => {
    const { container } = mount(<IssueGeneratedIssuesField issue={idea} />);

    expect(container.textContent).toContain(FIELD_LABELS.generatedIssues);
    expect(container.textContent).toContain("Issue provenance");
    expect(container.textContent).toContain("Surface detail rows");
    expect(container.querySelectorAll("a")).toHaveLength(2);
    expect(container.querySelector('[data-testid="generated-issues-rail"]')).toBeNull();
  });

  it("navigates to a plan root when its link is clicked", async () => {
    const { container } = mount(<IssueGeneratedIssuesField issue={idea} />);
    const links = container.querySelectorAll("a");

    await act(async () => {
      links[1]?.click();
    });

    expect(go).toHaveBeenCalledWith("detail-rows");
  });

  it("renders nothing when planRoots is empty", () => {
    queryState.derived = { capture: { blocked: false, planRoots: [] } };

    const { container } = mount(<IssueGeneratedIssuesField issue={idea} />);

    expect(container.textContent).toBe("");
  });

  it("renders an append Idea's Tasks on the Story Task rail, not the target Story", () => {
    queryState.issues = appendIssues;
    queryState.derived = {
      "idea-pr": { blocked: false, planRoots: ["oauth-hardening"] },
    };

    const { container } = mount(
      <IssueGeneratedIssuesField issue={appendIdea} />,
    );

    expect(container.textContent).toContain(FIELD_LABELS.generatedIssues);
    expect(container.textContent).toContain(
      "Tighten redirect allowlist per review",
    );
    expect(container.textContent).toContain(
      "Validate state parameter on callback",
    );
    expect(container.textContent).toContain("e7f8a9b");
    expect(container.textContent).not.toContain("OAuth callback hardening");
    expect(container.textContent).not.toContain("Wire the callback");

    const rail = container.querySelector('[data-testid="generated-issues-rail"]');
    expect(rail).not.toBeNull();
    expect(rail?.getAttribute("role")).toBe("list");
    const nodes = rail?.querySelectorAll('[role="listitem"]');
    expect(nodes).toHaveLength(2);
  });

  it("is read-only for a planned append Idea", () => {
    queryState.issues = appendIssues;
    queryState.derived = {
      "idea-pr": { blocked: false, planRoots: ["oauth-hardening"] },
    };

    const { container } = mount(
      <IssueGeneratedIssuesField issue={appendIdea} />,
    );

    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector("input")).toBeNull();
    expect(container.querySelector('[aria-label*="Edit" i]')).toBeNull();
    expect(container.querySelector('[aria-label*="Clear" i]')).toBeNull();
  });
});
