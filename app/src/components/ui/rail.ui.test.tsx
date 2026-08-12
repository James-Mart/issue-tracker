// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Rail, RailNode } from "./rail";
import type { RailNodeState } from "@/features/issues/lib/rail-state";

/** Uneven row geometry: node 1 stands in for a wrapping, double-height label. */
const GEOMETRY = [
  { top: 0, height: 40 },
  { top: 40, height: 80 },
  { top: 120, height: 40 },
];

/**
 * happy-dom does no layout, so every element reports the box the test declares
 * on it — the rail sits at 0, each row at its own offset.
 */
function mockLayout() {
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value(this: HTMLElement) {
      const top = Number(this.dataset.rectTop ?? 0);
      const height = Number(this.dataset.rectHeight ?? 0);
      return { top, height, bottom: top + height };
    },
  });
}

function railTree(states: readonly RailNodeState[], live = true) {
  return (
    <Rail live={live}>
      {states.map((state, index) => (
        <RailNode
          key={index}
          state={state}
          edge="solid"
          label={`node ${index}`}
          data-rect-top={GEOMETRY[index].top}
          data-rect-height={GEOMETRY[index].height}
        />
      ))}
    </Rail>
  );
}

function workCursor(container: ParentNode): HTMLElement | null {
  return container.querySelector('[data-testid="rail-work-cursor"]');
}

let container: HTMLDivElement;
let root: Root;

function render(states: readonly RailNodeState[], live = true) {
  act(() => {
    root.render(railTree(states, live));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  mockLayout();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("Rail work-cursor", () => {
  it("rests on the measured center of the in-flight port", () => {
    render(["merged", "in-flight", "ready"]);
    const cursor = workCursor(container);

    expect(cursor).toBeTruthy();
    // Center of the taller row, not a uniform fraction of the rail.
    expect(cursor!.style.top).toBe("80px");
  });

  it("stays hidden on first paint with work already on a step", () => {
    render(["merged", "in-flight", "ready"]);
    const cursor = workCursor(container);

    expect(cursor!.getAttribute("data-traveling")).toBe("false");
    expect(cursor!.className).toMatch(/\bopacity-0\b/);
    expect(cursor!.className).toMatch(
      /motion-safe:data-\[traveling=true\]:opacity-100/,
    );
  });

  it("travels to the next measured port, then hides again on arrival", () => {
    render(["merged", "in-flight", "ready"]);
    render(["merged", "merged", "in-flight"]);

    const traveling = workCursor(container);
    expect(traveling!.getAttribute("data-traveling")).toBe("true");
    expect(traveling!.style.top).toBe("140px");

    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(workCursor(container)!.getAttribute("data-traveling")).toBe("false");
  });

  it("leaves the spine when no step is in flight", () => {
    render(["merged", "in-flight", "ready"]);
    render(["merged", "merged", "merged"]);

    expect(workCursor(container)).toBeNull();
  });

  it("comes to rest hidden when work rejoins the spine mid-travel", () => {
    render(["merged", "in-flight", "ready"]);
    render(["merged", "merged", "in-flight"]);
    expect(workCursor(container)!.getAttribute("data-traveling")).toBe("true");

    render(["merged", "merged", "merged"]);
    render(["in-flight", "ready", "ready"]);

    const cursor = workCursor(container);
    expect(cursor!.style.top).toBe("20px");
    expect(cursor!.getAttribute("data-traveling")).toBe("false");
  });

  it("carries no work-cursor when the rail is not live", () => {
    render(["merged", "in-flight", "ready"], false);

    expect(workCursor(container)).toBeNull();
  });
});
