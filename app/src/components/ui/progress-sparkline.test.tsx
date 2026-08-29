// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { ProgressSparkline } from "./progress-sparkline";

function mountSparkline(): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <ProgressSparkline
        stages={[
          { name: "not started", tone: "done" },
          { name: "in progress", tone: "current" },
          { name: "PR open", tone: "idle" },
        ]}
      />,
    );
  });
  return container;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ProgressSparkline", () => {
  it("names each stage for hover and focus without printing them inline", () => {
    const container = mountSparkline();
    const rail = container.querySelector('[data-testid="progress-sparkline"]');
    expect(rail?.getAttribute("aria-label")).toBe("Progress: in progress");

    const dots = container.querySelectorAll('[data-testid="sparkline-dot"]');
    expect([...dots].map((dot) => dot.getAttribute("data-stage"))).toEqual([
      "not started",
      "in progress",
      "PR open",
    ]);
    expect([...dots].map((dot) => dot.getAttribute("title"))).toEqual([
      "not started",
      "in progress",
      "PR open",
    ]);
    expect([...dots].every((dot) => dot.getAttribute("tabindex") === "0")).toBe(
      true,
    );
    expect(rail?.className).toMatch(/inline-flex/);
    expect(rail?.className).not.toMatch(/flex-col/);
  });
});
