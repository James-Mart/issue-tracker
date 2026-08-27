// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { DerivedState, IssueRecord } from "@server/schemas";
import type { FlowBuckets, FlowItem } from "../lib/flow";
import {
  AWAITING_PLANNING_PREVIEW_LIMIT,
  FlowBucketsSections,
  FlowPreviewedItems,
  partitionCockpitBuckets,
} from "./flow-buckets-sections";

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

function epic(id: string, needsAttention = false): IssueRecord {
  return {
    id,
    kind: "epic",
    title: id,
    partOf: "p",
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    needsAttention,
    attentionReason: needsAttention ? "check" : null,
    blockedBy: [],
    archived: false,
  };
}

function row(issue: IssueRecord, state?: DerivedState): FlowItem {
  return { issue, state };
}

function emptyBuckets(
  overrides: Partial<FlowBuckets> = {},
): FlowBuckets {
  return {
    awaitingPlanning: [],
    ready: [],
    inFlight: [],
    blocked: [],
    recentlyMerged: [],
    ...overrides,
  };
}

function mountSections(
  buckets: FlowBuckets,
): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <FlowBucketsSections
        buckets={buckets}
        idPrefix="test"
        renderRow={(item) => <a href={`#${item.issue.id}`}>{item.issue.title}</a>}
      />,
    );
  });
  return { container, root };
}

function section(container: ParentNode, key: string): HTMLElement | null {
  return container.querySelector(`section[aria-labelledby="test-${key}"]`);
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("partitionCockpitBuckets", () => {
  it("lifts needs-attention rows out of lifecycle buckets", () => {
    const flagged = row(epic("flagged", true), {
      blocked: false,
      epicStatus: "todo",
    });
    const ready = row(epic("ready"), { blocked: false, epicStatus: "todo" });
    const inFlight = row(epic("flight"), {
      blocked: false,
      epicStatus: "in-progress",
    });

    const partitioned = partitionCockpitBuckets(
      emptyBuckets({
        ready: [flagged, ready],
        inFlight: [inFlight],
      }),
    );

    expect(partitioned.needsAttention.map((item) => item.issue.id)).toEqual([
      "flagged",
    ]);
    expect(partitioned.buckets.ready.map((item) => item.issue.id)).toEqual([
      "ready",
    ]);
    expect(partitioned.buckets.inFlight.map((item) => item.issue.id)).toEqual([
      "flight",
    ]);
  });

  it("lifts awaiting-direction Ideas and leaves an implementing Story in place", () => {
    const awaiting = row(idea("awaiting"), {
      blocked: false,
      ideaStatus: "awaiting-direction",
    });
    const implementing = row(story("implementing"), {
      blocked: false,
      storyStatus: "in-progress",
    });

    const partitioned = partitionCockpitBuckets(
      emptyBuckets({
        ready: [awaiting],
        inFlight: [implementing],
      }),
    );

    expect(partitioned.needsAttention.map((item) => item.issue.id)).toEqual([
      "awaiting",
    ]);
    expect(partitioned.buckets.ready).toEqual([]);
    expect(partitioned.buckets.inFlight.map((item) => item.issue.id)).toEqual([
      "implementing",
    ]);
  });
});

describe("FlowBucketsSections", () => {
  it("hides empty buckets", () => {
    const buckets = emptyBuckets({
      ready: [row(epic("ready"), { blocked: false, epicStatus: "todo" })],
    });
    const { container } = mountSections(buckets);

    expect(section(container, "inFlight")).toBeNull();
    expect(section(container, "needsAttention")).toBeNull();
  });

  it("partitions awaiting-direction Ideas into attention", () => {
    const buckets = emptyBuckets({
      ready: [
        row(idea("awaiting"), {
          blocked: false,
          ideaStatus: "awaiting-direction",
        }),
        row(epic("ready"), { blocked: false, epicStatus: "todo" }),
      ],
      inFlight: [
        row(story("implementing"), {
          blocked: false,
          storyStatus: "in-progress",
        }),
      ],
    });

    const { container } = mountSections(buckets);
    expect(section(container, "needsAttention")?.textContent).toContain(
      "awaiting",
    );
    expect(section(container, "ready")?.textContent).toContain("ready");
    expect(section(container, "ready")?.textContent).not.toContain(
      "awaiting",
    );
    expect(section(container, "inFlight")?.textContent).toContain(
      "implementing",
    );
  });

  it("does not render blocked work on the cockpit", () => {
    const buckets = emptyBuckets({
      ready: [row(epic("ready"), { blocked: false, epicStatus: "todo" })],
      blocked: [row(epic("blocked"), { blocked: true, epicStatus: "todo" })],
    });
    const { container } = mountSections(buckets);

    expect(section(container, "blocked")).toBeNull();
    expect(section(container, "ready")?.querySelector('a[href="#ready"]')).toBeTruthy();
  });

  it("collapses recently merged", () => {
    const buckets = emptyBuckets({
      ready: [row(epic("ready"), { blocked: false, epicStatus: "todo" })],
      recentlyMerged: [
        row(story("merged"), { blocked: false, storyStatus: "merged" }),
      ],
    });
    const { container } = mountSections(buckets);

    expect(section(container, "inFlight")).toBeNull();

    const recentlyMerged = section(container, "recentlyMerged");
    expect(recentlyMerged).toBeTruthy();
    const details = recentlyMerged?.querySelector("details");
    expect(details).toBeTruthy();
    expect(details?.open).toBe(false);

    act(() => {
      recentlyMerged?.querySelector("summary")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(details?.open).toBe(true);
    expect(recentlyMerged?.querySelector('a[href="#merged"]')).toBeTruthy();
  });

  it("renders needs-attention before in-flight", () => {
    const buckets = emptyBuckets({
      ready: [
        row(epic("attention", true), { blocked: false, epicStatus: "todo" }),
      ],
      inFlight: [
        row(epic("flight"), { blocked: false, epicStatus: "in-progress" }),
      ],
    });

    const { container } = mountSections(buckets);
    const headings = [...container.querySelectorAll("h2")].map((node) =>
      node.textContent?.replace(/\d+/g, "").trim(),
    );
    expect(headings.indexOf("Needs attention")).toBeLessThan(
      headings.indexOf("In flight"),
    );
    expect(section(container, "needsAttention")?.textContent).toContain("1");
    expect(section(container, "inFlight")?.querySelector("a")).toBeTruthy();
  });

  it("renders Ready before Awaiting planning and In flight", () => {
    const buckets = emptyBuckets({
      awaitingPlanning: [
        row(idea("captured"), { blocked: false, ideaStatus: "captured" }),
      ],
      ready: [
        row(epic("ready"), { blocked: false, epicStatus: "todo" }),
        row(epic("attention", true), { blocked: false, epicStatus: "todo" }),
      ],
      inFlight: [
        row(epic("flight"), { blocked: false, epicStatus: "in-progress" }),
      ],
    });

    const { container } = mountSections(buckets);
    const headings = [...container.querySelectorAll("h2")].map((node) =>
      node.textContent?.replace(/\d+/g, "").trim(),
    );
    expect(headings.indexOf("Needs attention")).toBeLessThan(
      headings.indexOf("Ready"),
    );
    expect(headings.indexOf("Ready")).toBeLessThan(
      headings.indexOf("Awaiting planning"),
    );
    expect(headings.indexOf("Awaiting planning")).toBeLessThan(
      headings.indexOf("In flight"),
    );

    const awaiting = section(container, "awaitingPlanning");
    expect(awaiting).toBeTruthy();
    expect(awaiting?.querySelector("details")).toBeNull();
    expect(awaiting?.textContent).toContain("captured");
    expect(awaiting?.textContent).toContain("1");
  });

  it("shows five captured Ideas until Show all reveals the sixth", () => {
    const awaitingPlanning = Array.from({ length: 6 }, (_, index) =>
      row(idea(`idea-${index}`), { blocked: false, ideaStatus: "captured" }),
    );
    const buckets = emptyBuckets({ awaitingPlanning });

    const { container } = mountSections(buckets);
    const awaiting = section(container, "awaitingPlanning");
    expect(awaiting?.querySelectorAll("a")).toHaveLength(
      AWAITING_PLANNING_PREVIEW_LIMIT,
    );
    expect(awaiting?.textContent).toContain("idea-4");
    expect(awaiting?.textContent).not.toContain("idea-5");

    const showAll = [...(awaiting?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent === "Show all",
    );
    expect(showAll).toBeTruthy();
    act(() => {
      showAll?.click();
    });
    expect(awaiting?.querySelectorAll("a")).toHaveLength(6);
    expect(awaiting?.textContent).toContain("idea-5");
    expect(awaiting?.textContent).not.toContain("Show all");
  });
});

describe("FlowPreviewedItems", () => {
  it("caps each project group independently", () => {
    const groupA = Array.from({ length: 6 }, (_, index) =>
      row(idea(`a-${index}`), { blocked: false, ideaStatus: "captured" }),
    );
    const groupB = [
      row(idea("b-0"), { blocked: false, ideaStatus: "captured" }),
      row(idea("b-1"), { blocked: false, ideaStatus: "captured" }),
    ];
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <div>
          <div data-group="a">
            <FlowPreviewedItems
              items={groupA}
              previewLimit={AWAITING_PLANNING_PREVIEW_LIMIT}
              renderItem={(item) => (
                <a href={`#${item.issue.id}`}>{item.issue.title}</a>
              )}
            />
          </div>
          <div data-group="b">
            <FlowPreviewedItems
              items={groupB}
              previewLimit={AWAITING_PLANNING_PREVIEW_LIMIT}
              renderItem={(item) => (
                <a href={`#${item.issue.id}`}>{item.issue.title}</a>
              )}
            />
          </div>
        </div>,
      );
    });

    const a = container.querySelector("[data-group=a]");
    const b = container.querySelector("[data-group=b]");
    expect(a?.querySelectorAll("a")).toHaveLength(5);
    expect(a?.textContent).not.toContain("a-5");
    expect(b?.querySelectorAll("a")).toHaveLength(2);
    expect(b?.querySelector("button")).toBeNull();

    const showAll = [...(a?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent === "Show all",
    );
    act(() => {
      showAll?.click();
    });
    expect(a?.querySelectorAll("a")).toHaveLength(6);
    expect(a?.textContent).toContain("a-5");
    expect(b?.querySelectorAll("a")).toHaveLength(2);

    act(() => {
      root.unmount();
    });
  });
});
