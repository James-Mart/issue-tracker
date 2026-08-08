// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OverviewNewMenu } from "./overview-new-menu";

vi.mock("../store/use-issue-ui-store", () => ({
  useIssueUiStore: (selector: (state: { openNew: () => void }) => unknown) =>
    selector({ openNew: vi.fn() }),
}));

function mountNewMenu(projectId = "seed-proj"): {
  container: HTMLDivElement;
  root: Root;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<OverviewNewMenu projectId={projectId} />);
  });
  return { container, root };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("OverviewNewMenu", () => {
  it("renders a primary New dropdown trigger in the shared toolbar", () => {
    const { container } = mountNewMenu();
    const button = container.querySelector('[aria-label="New"]');
    expect(button).toBeTruthy();
    expect(button?.textContent).toContain("New");
  });
});
