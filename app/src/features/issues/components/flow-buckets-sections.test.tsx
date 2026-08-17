// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { DerivedState, IssueRecord } from "@server/schemas";
import type { FlowBuckets, FlowItem } from "../lib/flow";
import {
  FlowBucketsSections,
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

function mountSections(
  buckets: FlowBuckets,
  variant: "overview" | "cockpit" = "overview",
): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <FlowBucketsSections
        buckets={buckets}
        idPrefix="test"
        variant={variant}
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

    const partitioned = partitionCockpitBuckets({
      ready: [flagged, ready],
      inFlight: [inFlight],
      blocked: [],
      recentlyMerged: [],
    });

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

    const partitioned = partitionCockpitBuckets({
      ready: [awaiting],
      inFlight: [implementing],
      blocked: [],
      recentlyMerged: [],
    });

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
  it("overview keeps empty buckets visible with empty copy", () => {
    const buckets: FlowBuckets = {
      ready: [row(epic("ready"), { blocked: false, epicStatus: "todo" })],
      inFlight: [],
      blocked: [],
      recentlyMerged: [],
    };
    const { container } = mountSections(buckets, "overview");

    expect(section(container, "inFlight")).toBeTruthy();
    expect(container.textContent).toContain(
      "Nothing in flight. Pick up Ready work or start a Story.",
    );
    expect(section(container, "needsAttention")).toBeNull();
  });

  it("partitions awaiting-direction Ideas into attention under both variants", () => {
    const buckets: FlowBuckets = {
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
      blocked: [],
      recentlyMerged: [],
    };

    for (const variant of ["overview", "cockpit"] as const) {
      const { container, root } = mountSections(buckets, variant);
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
      act(() => {
        root.unmount();
      });
    }
  });

  it("cockpit hides empty buckets and collapses backlog sections", () => {
    const buckets: FlowBuckets = {
      ready: [row(epic("ready"), { blocked: false, epicStatus: "todo" })],
      inFlight: [],
      blocked: [row(epic("blocked"), { blocked: true, epicStatus: "todo" })],
      recentlyMerged: [],
    };
    const { container } = mountSections(buckets, "cockpit");

    expect(section(container, "inFlight")).toBeNull();
    expect(section(container, "recentlyMerged")).toBeNull();

    const blocked = section(container, "blocked");
    expect(blocked).toBeTruthy();
    const details = blocked?.querySelector("details");
    expect(details).toBeTruthy();
    expect(details?.open).toBe(false);

    act(() => {
      blocked?.querySelector("summary")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(details?.open).toBe(true);
    expect(blocked?.querySelector('a[href="#blocked"]')).toBeTruthy();
  });

  it("cockpit renders needs-attention before in-flight", () => {
    const buckets: FlowBuckets = {
      ready: [
        row(epic("attention", true), { blocked: false, epicStatus: "todo" }),
      ],
      inFlight: [
        row(epic("flight"), { blocked: false, epicStatus: "in-progress" }),
      ],
      blocked: [],
      recentlyMerged: [],
    };

    const { container } = mountSections(buckets, "cockpit");
    const headings = [...container.querySelectorAll("h2")].map((node) =>
      node.textContent?.replace(/\d+/g, "").trim(),
    );
    expect(headings.indexOf("Needs attention")).toBeLessThan(
      headings.indexOf("In flight"),
    );
    expect(section(container, "needsAttention")?.textContent).toContain("1");
    expect(section(container, "inFlight")?.querySelector("a")).toBeTruthy();
  });
});
