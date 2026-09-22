// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { ProjectLabel } from "@server/schemas";
import { OverviewLabelsRow } from "./overview-labels-row";

const catalog: ProjectLabel[] = [
  { id: "bug", color: "#ef4444", description: "Defect" },
  { id: "enhancement", color: "#22c55e", description: "Improvement" },
  { id: "meta-confusion", color: "#a855f7", description: "Confusing meta" },
];

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

function chipIds(container: HTMLElement): string[] {
  return [...container.querySelectorAll("span.font-mono")].map(
    (el) => el.textContent ?? "",
  );
}

describe("OverviewLabelsRow", () => {
  it("shows only assigned catalog labels in catalog order plus Edit labels", () => {
    const { container } = mount(
      <OverviewLabelsRow
        catalog={catalog}
        assignmentIds={["meta-confusion", "bug"]}
      />,
    );

    expect(chipIds(container)).toEqual(["bug", "meta-confusion"]);
    expect(container.querySelector('[aria-label="Edit labels"]')).toBeTruthy();
    expect(container.textContent).toContain("Edit labels");
  });

  it("does not render catalog labels that are not on the issue", () => {
    const { container } = mount(
      <OverviewLabelsRow
        catalog={catalog}
        assignmentIds={["bug"]}
      />,
    );

    expect(chipIds(container)).toEqual(["bug"]);
    expect(container.textContent).not.toContain("enhancement");
  });

  it("shows Edit labels with no chips when the issue has no labels", () => {
    const { container } = mount(
      <OverviewLabelsRow catalog={catalog} assignmentIds={[]} />,
    );

    expect(chipIds(container)).toEqual([]);
    expect(container.querySelector('[aria-label="Edit labels"]')).toBeTruthy();
  });

  it("shows the empty-catalog sentence and no Edit labels button", () => {
    const { container } = mount(
      <OverviewLabelsRow catalog={[]} assignmentIds={["bug"]} />,
    );

    expect(container.textContent).toContain(
      "No labels in the catalog. Add them in project settings, then assign them here.",
    );
    expect(container.querySelector('[aria-label="Edit labels"]')).toBeNull();
    expect(chipIds(container)).toEqual([]);
  });
});
