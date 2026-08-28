// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { pipelines } from "../shape";
import { PipelinePage } from "./pipeline-page";

function LocationProbe() {
  const { pathname, search } = useLocation();
  return <div data-testid="location-probe">{pathname + search}</div>;
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

function tab(container: ParentNode, label: string): HTMLElement {
  const match = Array.from(container.querySelectorAll('[role="tab"]')).find(
    (el) => el.textContent?.trim() === label,
  );
  if (!(match instanceof HTMLElement)) {
    throw new Error(`Missing tab: ${label}`);
  }
  return match;
}

function pipelineTabs(container: ParentNode): HTMLElement[] {
  const list = container.querySelector('[role="tablist"][aria-label="Pipeline"]');
  if (!(list instanceof HTMLElement)) {
    throw new Error("Missing pipeline switch");
  }
  return Array.from(list.querySelectorAll('[role="tab"]'));
}

function diagram(container: ParentNode): HTMLElement {
  const el = container.querySelector('[data-testid="pipeline-diagram"]');
  if (!(el instanceof HTMLElement)) {
    throw new Error("Missing pipeline diagram");
  }
  return el;
}

function nodeEl(container: ParentNode, id: string): HTMLElement {
  const el = container.querySelector(
    `[data-testid="pipeline-node"][data-id="${id}"]`,
  );
  if (!(el instanceof HTMLElement)) {
    throw new Error(`Missing node: ${id}`);
  }
  return el;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("PipelinePage", () => {
  it("renders the planning pipeline diagram on /pipeline", () => {
    const { container } = mountPipelinePage("/pipeline");
    expect(diagram(container).getAttribute("data-pipeline")).toBe("planning");
    expect(container.textContent).toContain("Planning");
    expect(tab(container, "Design").getAttribute("aria-selected")).toBe("true");
  });

  it("offers every declared pipeline and defaults to planning", () => {
    const { container } = mountPipelinePage("/pipeline");
    const tabs = pipelineTabs(container);
    expect(tabs.map((el) => el.textContent?.trim())).toEqual(
      pipelines.map((pipeline) => pipeline.title),
    );
    expect(tab(container, "Planning").getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(diagram(container).getAttribute("data-pipeline")).toBe("planning");
  });

  it("draws the selected pipeline when the switch is activated", () => {
    const { container } = mountPipelinePage("/pipeline");
    act(() => {
      tab(container, "Work the stack").click();
    });
    expect(diagram(container).getAttribute("data-pipeline")).toBe("work");
    expect(tab(container, "Work the stack").getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(
      container.querySelector('[data-testid="location-probe"]')?.textContent,
    ).toBe("/pipeline?pipeline=work");
    expect(container.textContent).toContain("Implementor");
    expect(container.textContent).not.toContain("Grill-me protocol");
  });

  it("draws the pipeline named in the query string", () => {
    const { container } = mountPipelinePage("/pipeline?pipeline=work");
    expect(diagram(container).getAttribute("data-pipeline")).toBe("work");
    expect(tab(container, "Work the stack").getAttribute("aria-selected")).toBe(
      "true",
    );
  });

  it("switches the canvas when a handoff node is activated", () => {
    const { container } = mountPipelinePage("/pipeline");
    act(() => {
      nodeEl(container, "work-handoff").click();
    });
    expect(diagram(container).getAttribute("data-pipeline")).toBe("work");
    expect(nodeEl(container, "planning-handoff").getAttribute("data-target-pipeline")).toBe(
      "planning",
    );
    expect(
      container.querySelector('[data-testid="location-probe"]')?.textContent,
    ).toBe("/pipeline?pipeline=work");

    act(() => {
      nodeEl(container, "planning-handoff").click();
    });
    expect(diagram(container).getAttribute("data-pipeline")).toBe("planning");
    expect(
      container.querySelector('[data-testid="location-probe"]')?.textContent,
    ).toBe("/pipeline");
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
    expect(
      container.querySelector('[data-testid="pipeline-diagram"]'),
    ).not.toBeNull();
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
