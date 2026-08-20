// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FIELD_LABELS } from "@server/fields";
import type { DerivedState } from "@server/schemas";
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

const idea = {
  kind: "idea" as const,
  id: "capture",
  title: "Better capture flow",
  partOf: "platform",
  order: 0,
  archived: false,
  createdAt: t0,
  updatedAt: t0,
};

const issues = [
  {
    kind: "project" as const,
    id: "platform",
    title: "Platform",
    mergePolicy: "manual" as const,
    order: 0,
    createdAt: t0,
    updatedAt: t0,
  },
  idea,
  {
    kind: "epic" as const,
    id: "provenance-epic",
    title: "Issue provenance",
    partOf: "platform",
    order: 0,
    archived: false,
    needsAttention: false,
    createdAt: t0,
    updatedAt: t0,
    sourceIdea: "capture",
  },
  {
    kind: "story" as const,
    id: "detail-rows",
    title: "Surface detail rows",
    partOf: "platform",
    order: 1,
    archived: false,
    needsAttention: false,
    createdAt: t0,
    updatedAt: t0,
    sourceIdea: "capture",
  },
];

const queryState: {
  derived: Record<string, DerivedState>;
} = {
  derived: {
    capture: { blocked: false, planRoots: ["provenance-epic", "detail-rows"] },
  },
};

vi.mock("../api/queries", () => ({
  useIssuesQuery: () => ({
    data: {
      issues,
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
});
