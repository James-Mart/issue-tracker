// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import type { DerivedState, IssueRecord } from "@server/schemas";
import { issueChannelPath, issuePath } from "../lib/links";
import { FlowRow } from "./flow-row";

const t0 = "2026-07-01T00:00:00.000Z";
const projectId = "p";

function project(id: string): IssueRecord {
  return {
    id,
    kind: "project",
    title: id,
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    archived: false,
  };
}

function idea(id: string, partOf = projectId): IssueRecord {
  return {
    id,
    kind: "idea",
    title: id,
    partOf,
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
  launchFault?: string,
  to?: string,
  issues?: IssueRecord[],
): HTMLDivElement {
  const rowIssues = issues ?? [project(projectId), issue];
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter>
        <FlowRow
          item={{ issue, state }}
          issues={rowIssues}
          actions={actions}
          launchFault={launchFault}
          to={to}
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

    const capturedRow = mountRow(idea("capture"), {
      blocked: false,
      ideaStatus: "captured",
    });
    expect(capturedRow.textContent).not.toContain("planning");
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
  });

  it("shows the amber awaiting approval badge without a demand icon", () => {
    const container = mountRow(idea("gate"), {
      blocked: false,
      ideaStatus: "awaiting-approval",
    });
    expect(
      container.querySelector('[aria-label="needs attention"]'),
    ).toBeNull();
    expect(container.textContent).toContain("awaiting approval");
    expect(container.textContent).not.toContain("planning");
  });

  it("drills awaiting-approval Ideas into the Planning tab", () => {
    const gate = idea("gate");
    const container = mountRow(
      gate,
      {
        blocked: false,
        ideaStatus: "awaiting-approval",
      },
      undefined,
      undefined,
      issuePath(projectId, gate.id),
    );
    const link = container.querySelector('a[aria-label="gate"]');
    expect(link?.getAttribute("href")).toBe(
      issueChannelPath(projectId, gate.id, "planning"),
    );
  });

  it("keeps the default issue drill-in for other Idea statuses", () => {
    const grill = idea("grill");
    const container = mountRow(
      grill,
      {
        blocked: false,
        ideaStatus: "planning",
      },
      undefined,
      undefined,
      issuePath(projectId, grill.id),
    );
    const link = container.querySelector('a[aria-label="grill"]');
    expect(link?.getAttribute("href")).toBe(issuePath(projectId, grill.id));
  });

  it("shows the demand icon and no planning badge on planned Ideas", () => {
    const container = mountRow(idea("planned"), {
      blocked: false,
      ideaStatus: "planned",
    });
    expect(
      container.querySelector('[aria-label="needs attention"]'),
    ).toBeTruthy();
    expect(container.textContent).not.toContain("planning");
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

  it("attaches a launch fault under the row", () => {
    const container = mountRow(
      story("ready"),
      { blocked: false, storyStatus: "not-started" },
      <button type="button">Start work</button>,
      "Auth hardening — Work loop didn't start. Start work again.",
    );
    expect(
      container.querySelector('[data-testid="flow-row-launch-fault"]')
        ?.textContent,
    ).toBe("Auth hardening — Work loop didn't start. Start work again.");
  });

  it("shows no planning badge on Story rows", () => {
    const flying = mountRow(story("fly"), {
      blocked: false,
      storyStatus: "in-progress",
    });
    expect(flying.textContent).not.toContain("planning");

    const ready = mountRow(story("ready"), {
      blocked: false,
      storyStatus: "not-started",
    });
    expect(ready.textContent).not.toContain("planning");
  });
});
