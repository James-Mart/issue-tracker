// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import type { DerivedState, IssueRecord } from "@server/schemas";
import { issueChannelPath, issuePath } from "../lib/links";
import { FlowRow } from "./flow-row";

type StoryRecord = Extract<IssueRecord, { kind: "story" }>;

const t0 = "2026-07-01T00:00:00.000Z";
const projectId = "p";

function project(id: string): IssueRecord {
  return {
    id,
    kind: "project",
    title: id,
    trunk: "main",
    mergePolicy: "manual",
    maxImplementingRuns: 1,
    order: 0,
    createdAt: t0,
    updatedAt: t0,
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

function story(id: string): StoryRecord {
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
    reviewedTasks: [],
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

  it("reserves an icon slot left of the title and keeps chips snug after it", () => {
    const container = mountRow(
      idea("with-action"),
      { blocked: false, ideaStatus: "captured" },
      <button type="button">Start planning</button>,
    );
    expect(container.textContent).toContain("Start planning");
    const slot = container.querySelector(
      '[data-testid="cockpit-row-action-slot"]',
    ) as HTMLElement;
    expect(slot).toBeTruthy();
    expect(slot.textContent).toContain("Start planning");
    const title = container.querySelector(".cockpit-row-title") as HTMLElement;
    expect(title.textContent).toBe("with-action");
    expect(
      slot.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const lead = slot.parentElement as HTMLElement;
    expect(lead.className).not.toMatch(/flex-col/);
    expect(container.querySelector(".pointer-events-none")).toBeNull();
  });

  it("keeps a blank icon slot when the row has no action", () => {
    const container = mountRow(idea("quiet"), {
      blocked: false,
      ideaStatus: "planning",
    });
    const slot = container.querySelector(
      '[data-testid="cockpit-row-action-slot"]',
    ) as HTMLElement;
    expect(slot).toBeTruthy();
    expect(slot.childNodes).toHaveLength(0);
    expect(container.textContent).toContain("planning");
    const cluster = container.querySelector(".cockpit-row-cluster");
    expect(cluster?.textContent).toContain("quiet");
    expect(cluster?.textContent).toContain("planning");
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

  it("shows awaiting PR on a Ready-to-land Story with no prUrl", () => {
    const manual: IssueRecord = {
      ...story("manual"),
      mergePolicy: "manual",
    };
    const done: IssueRecord = {
      id: "t",
      kind: "task",
      title: "t",
      partOf: "manual",
      order: 0,
      createdAt: t0,
      updatedAt: t0,
      status: "done",
      commits: [],
      needsAttention: false,
      attentionReason: null,
      archived: false,
    };
    const container = mountRow(
      manual,
      { blocked: false, storyStatus: "in-progress", mergePolicy: "manual" },
      undefined,
      undefined,
      undefined,
      [project(projectId), manual, done],
    );
    expect(container.textContent).toContain("awaiting PR");
    expect(
      container.querySelector('[data-state="ready-to-land"]'),
    ).toBeTruthy();
  });

  it("shows a Queued chip without live glow on queued work roots", () => {
    const queued: IssueRecord = {
      ...story("queued"),
      workQueuedAt: "2026-07-01T00:00:00.000Z",
    };
    const container = mountRow(
      queued,
      { blocked: false, storyStatus: "not-started" },
    );
    expect(container.textContent).toContain("Queued");
    expect(container.querySelector('[data-state="in-flight"]')).toBeNull();
    const port = container.querySelector('[data-testid="rail-port"]');
    expect(port?.className).not.toMatch(/animate-live-dot/);
  });

  it("does not show awaiting PR when a Ready-to-land Story has a prUrl", () => {
    const parked: IssueRecord = { ...story("parked"), prUrl: "https://pr/1" };
    const container = mountRow(
      parked,
      { blocked: false, storyStatus: "pr-open" },
      undefined,
      undefined,
      undefined,
      [project(projectId), parked],
    );
    expect(container.textContent).not.toContain("awaiting PR");
    expect(
      container.querySelector('[data-state="ready-to-land"]'),
    ).toBeTruthy();
  });
});
