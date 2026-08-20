// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FIELD_LABELS } from "@server/fields";
import { IssueSourceIdeaField } from "./issue-source-idea-field";

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

vi.mock("../api/queries", () => ({
  useIssuesQuery: () => ({
    data: {
      issues: [
        {
          kind: "project",
          id: "platform",
          title: "Platform",
          mergePolicy: "manual",
          order: 0,
          createdAt: "2026-08-10T12:00:00.000Z",
          updatedAt: "2026-08-10T12:00:00.000Z",
        },
        {
          kind: "idea",
          id: "capture",
          title: "Better capture flow",
          partOf: "platform",
          order: 0,
          archived: false,
          createdAt: "2026-08-10T12:00:00.000Z",
          updatedAt: "2026-08-10T12:00:00.000Z",
        },
      ],
    },
  }),
}));

const t0 = "2026-08-10T12:00:00.000Z";

const epicWithSource = {
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
};

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
});

describe("IssueSourceIdeaField", () => {
  it("renders the source Idea title", () => {
    const { container } = mount(<IssueSourceIdeaField issue={epicWithSource} />);

    expect(container.textContent).toContain(FIELD_LABELS.sourceIdea);
    expect(container.textContent).toContain("Better capture flow");
  });

  it("navigates to the source Idea when the link is clicked", async () => {
    const { container } = mount(<IssueSourceIdeaField issue={epicWithSource} />);
    const link = container.querySelector("a") as HTMLAnchorElement;

    await act(async () => {
      link.click();
    });

    expect(go).toHaveBeenCalledWith("capture");
  });

  it("renders nothing when sourceIdea is unset", () => {
    const { container } = mount(
      <IssueSourceIdeaField
        issue={{
          ...epicWithSource,
          sourceIdea: undefined,
        }}
      />,
    );

    expect(container.textContent).toBe("");
  });
});
