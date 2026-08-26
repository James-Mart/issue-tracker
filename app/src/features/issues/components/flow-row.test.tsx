// @vitest-environment happy-dom
import { act } from "react";
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

function mountRow(issue: IssueRecord, state?: DerivedState): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter>
        <FlowRow item={{ issue, state }} issues={[issue]} />
      </MemoryRouter>,
    );
  });
  return container;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("FlowRow", () => {
  it("shows a planning chip only on in-flight Ideas, not captured Ideas or Stories", () => {
    const planningRow = mountRow(idea("grill"), {
      blocked: false,
      ideaStatus: "planning",
    });
    expect(planningRow.textContent).toContain("planning");

    const capturedRow = mountRow(idea("capture"), {
      blocked: false,
      ideaStatus: "captured",
    });
    expect(capturedRow.textContent).not.toContain("planning");

    const storyRow = mountRow(story("implementing"), {
      blocked: false,
      storyStatus: "in-progress",
    });
    expect(storyRow.textContent).not.toContain("planning");
  });

  it("shows the planning chip and needs-attention icon on awaiting-direction Ideas", () => {
    const container = mountRow(idea("stalled"), {
      blocked: false,
      ideaStatus: "awaiting-direction",
    });
    expect(container.textContent).toContain("planning");
    expect(container.querySelector('[aria-label="needs attention"]')).toBeTruthy();
  });
});
