// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { PipelinePage } from "./pipeline-page";

function LocationProbe() {
  const { pathname } = useLocation();
  return <div data-testid="location-probe">{pathname}</div>;
}

function mountPipelinePage(entry: string): {
  container: HTMLDivElement;
  root: Root;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/pipeline" element={<PipelinePage />} />
          <Route path="/pipeline/runs" element={<PipelinePage />} />
          <Route
            path="/pipeline/runs/:conversationId"
            element={<PipelinePage />}
          />
        </Routes>
        <LocationProbe />
      </MemoryRouter>,
    );
  });
  return { container, root };
}

function tab(container: ParentNode, label: string): HTMLAnchorElement {
  const match = Array.from(container.querySelectorAll('[role="tab"]')).find(
    (el) => el.textContent?.trim() === label,
  );
  if (!(match instanceof HTMLAnchorElement)) {
    throw new Error(`Missing tab: ${label}`);
  }
  return match;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("PipelinePage", () => {
  it("renders the design placeholder on /pipeline", () => {
    const { container } = mountPipelinePage("/pipeline");
    expect(container.textContent).toContain(
      "pipeline-diagram-kinds-and-loops replaces this placeholder.",
    );
    expect(tab(container, "Design").getAttribute("aria-selected")).toBe("true");
  });

  it("navigates to /pipeline/runs when Runs is selected", () => {
    const { container } = mountPipelinePage("/pipeline");
    act(() => {
      tab(container, "Runs").click();
    });
    expect(
      container.querySelector('[data-testid="location-probe"]')?.textContent,
    ).toBe("/pipeline/runs");
    expect(container.textContent).toContain(
      "run-list-and-selection replaces this placeholder.",
    );
    expect(tab(container, "Runs").getAttribute("aria-selected")).toBe("true");
  });

  it("navigates to /pipeline when Design is selected from runs", () => {
    const { container } = mountPipelinePage("/pipeline/runs");
    act(() => {
      tab(container, "Design").click();
    });
    expect(
      container.querySelector('[data-testid="location-probe"]')?.textContent,
    ).toBe("/pipeline");
    expect(container.textContent).toContain(
      "pipeline-diagram-kinds-and-loops replaces this placeholder.",
    );
  });

  it("renders the runs placeholder with conversationId from the route", () => {
    const { container } = mountPipelinePage("/pipeline/runs/conv-abc");
    expect(container.textContent).toContain(
      "run-list-and-selection replaces this placeholder.",
    );
    expect(container.textContent).toContain("conv-abc");
    expect(tab(container, "Runs").getAttribute("aria-selected")).toBe("true");
  });
});
