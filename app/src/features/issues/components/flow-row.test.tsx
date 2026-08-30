// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import type { DerivedState, IssueRecord } from "@server/schemas";
import { FlowRow } from "./flow-row";

const t0 = "2026-07-01T00:00:00.000Z";

function idea(id: string): IssueRecord {
  return {
    id,
    kind: "idea",
    title: id,
    partOf: "p",
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    archived: false,
  };
}

function story(id: string): IssueRecord {
  return {
    id,
    kind: "story",
    title: id,
    partOf: "p",
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    branchName: id,
    merged: false,
    needsAttention: false,
    attentionReason: null,
    archived: false,
  };
}

function mountRow(
  issue: IssueRecord,
  state?: DerivedState,
  actions?: ReactNode,
): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter>
        <FlowRow
          item={{ issue, state }}
          issues={[issue]}
          actions={actions}
        />
      </MemoryRouter>,
    );
  });
  return container;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("FlowRow", () => {
  it("puts the state disc on a rail node and shows a planning badge on directed Ideas", () => {
    const planningRow = mountRow(idea("grill"), {
      blocked: false,
      ideaStatus: "planning",
    });
    expect(planningRow.querySelector('[data-testid="rail-port"]')).toBeTruthy();
    expect(planningRow.textContent).toContain("planning");
    expect(
      planningRow.querySelector('[data-testid="progress-sparkline"]'),
    ).toBeNull();

    const capturedRow = mountRow(idea("capture"), {
      blocked: false,
      ideaStatus: "captured",
    });
    expect(capturedRow.textContent).not.toContain("planning");
    expect(
      capturedRow.querySelector('[data-testid="progress-sparkline"]'),
    ).toBeNull();
  });

  it("shows the demand icon and planning badge on awaiting-direction Ideas", () => {
    const container = mountRow(idea("stalled"), {
      blocked: false,
      ideaStatus: "awaiting-direction",
    });
    expect(
      container.querySelector('[aria-label="needs attention"]'),
    ).toBeTruthy();
    expect(container.textContent).toContain("planning");
    expect(
      container.querySelector('[data-testid="progress-sparkline"]'),
    ).toBeNull();
  });

  it("keeps title and actions on one line", () => {
    const container = mountRow(
      idea("with-action"),
      { blocked: false, ideaStatus: "captured" },
      <button type="button">Start planning</button>,
    );
    expect(container.textContent).toContain("Start planning");
    const actionButton = container.querySelector('button[type="button"]');
    const actionWrapper = actionButton?.parentElement as HTMLElement;
    expect(actionWrapper.className).toMatch(/flex-nowrap/);
    expect(actionWrapper.className).not.toMatch(/flex-wrap/);
    expect(actionWrapper.parentElement?.className).not.toMatch(/flex-col/);
    expect(container.querySelector(".pointer-events-none")).toBeNull();
  });

  it("shows no planning badge or sparkline on Story rows", () => {
    const flying = mountRow(story("fly"), {
      blocked: false,
      storyStatus: "in-progress",
    });
    expect(flying.textContent).not.toContain("planning");
    expect(
      flying.querySelector('[data-testid="progress-sparkline"]'),
    ).toBeNull();

    const ready = mountRow(story("ready"), {
      blocked: false,
      storyStatus: "not-started",
    });
    expect(ready.textContent).not.toContain("planning");
    expect(
      ready.querySelector('[data-testid="progress-sparkline"]'),
    ).toBeNull();
  });
});
