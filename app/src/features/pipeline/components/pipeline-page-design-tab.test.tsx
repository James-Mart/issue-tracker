// @vitest-environment happy-dom
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { pipelines } from "../shape";
import {
  diagram,
  mountPipelinePage,
  nodeEl,
  pageEyebrow,
  pipelineTabs,
  tab,
} from "./pipeline-page.test-helpers";

describe("PipelinePage design tab", () => {
  it("renders the planning pipeline diagram on /pipelines with a Pipelines eyebrow", () => {
    const { container } = mountPipelinePage("/pipelines");
    expect(pageEyebrow(container)).toBe("Pipelines");
    expect(diagram(container).getAttribute("data-pipeline")).toBe("planning");
    expect(container.textContent).toContain("Planning");
    expect(
      container.querySelector('[role="tablist"][aria-label="Pipeline view"]'),
    ).toBeNull();
  });

  it("offers every declared pipeline and defaults to planning", () => {
    const { container } = mountPipelinePage("/pipelines");
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
    const { container } = mountPipelinePage("/pipelines");
    act(() => {
      tab(container, "Work the stack").click();
    });
    expect(diagram(container).getAttribute("data-pipeline")).toBe("work");
    expect(tab(container, "Work the stack").getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(
      container.querySelector('[data-testid="location-probe"]')?.textContent,
    ).toBe("/pipelines?pipeline=work");
    expect(container.textContent).toContain("Implementor");
    expect(container.textContent).not.toContain("Grill-me protocol");
  });

  it("draws the pipeline named in the query string", () => {
    const { container } = mountPipelinePage("/pipelines?pipeline=work");
    expect(diagram(container).getAttribute("data-pipeline")).toBe("work");
    expect(tab(container, "Work the stack").getAttribute("aria-selected")).toBe(
      "true",
    );
  });

  it("switches the canvas when a handoff node is activated", () => {
    const { container } = mountPipelinePage("/pipelines");
    act(() => {
      nodeEl(container, "work-handoff").click();
    });
    expect(diagram(container).getAttribute("data-pipeline")).toBe("work");
    expect(nodeEl(container, "planning-handoff").getAttribute("data-target-pipeline")).toBe(
      "planning",
    );
    expect(
      container.querySelector('[data-testid="location-probe"]')?.textContent,
    ).toBe("/pipelines?pipeline=work");

    act(() => {
      nodeEl(container, "planning-handoff").click();
    });
    expect(diagram(container).getAttribute("data-pipeline")).toBe("planning");
    expect(
      container.querySelector('[data-testid="location-probe"]')?.textContent,
    ).toBe("/pipelines");
  });

  it("does not open a panel when a handoff node is activated", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { container } = mountPipelinePage("/pipelines");
    act(() => {
      nodeEl(container, "work-handoff").click();
    });
    expect(diagram(container).getAttribute("data-pipeline")).toBe("work");
    expect(
      container.querySelector('[data-testid="pipeline-step-source-panel"]'),
    ).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
