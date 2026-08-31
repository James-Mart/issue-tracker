// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import type { DerivedState, IssueRecord } from "@server/schemas";
import type { FlowBuckets, FlowItem } from "../lib/flow";
import { projectLensPath } from "../lib/links";
import { RailNode } from "@/components/ui/rail";
import {
  AWAITING_PLANNING_PREVIEW_LIMIT,
  FlowBucketsSections,
  FlowPreviewedItems,
  READY_EMPTY_COPY,
  partitionCockpitBuckets,
  readyEmptyCopy,
} from "./flow-buckets-sections";

const t0 = "2026-07-01T00:00:00.000Z";

function idea(id: string, partOf = "p"): IssueRecord {
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

function story(id: string, partOf = "p"): IssueRecord {
  return {
    id,
    kind: "story",
    title: id,
    partOf,
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

function epic(id: string, needsAttention = false, partOf = "p"): IssueRecord {
  return {
    id,
    kind: "epic",
    title: id,
    partOf,
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

const FLOW_BUCKET_HEADING_ORDER = [
  "Needs attention",
  "In flight",
  "Ready",
  "Awaiting planning",
] as const;

function headingLabels(container: ParentNode): string[] {
  return [...container.querySelectorAll("section button[type='button']")].map(
    (node) => node.textContent?.replace(/\d+/g, "").trim() ?? "",
  );
}

function mountSections(
  buckets: FlowBuckets,
): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter>
        <FlowBucketsSections
          buckets={buckets}
          idPrefix="test"
          renderRow={(item) => <a href={`#${item.issue.id}`}>{item.issue.title}</a>}
        />
      </MemoryRouter>,
    );
  });
  return { container, root };
}

function section(container: ParentNode, key: string): HTMLElement | null {
  return container.querySelector(`section[aria-labelledby="test-${key}"]`);
}

function headingButton(container: ParentNode, key: string): HTMLButtonElement | null {
  return container.querySelector(`#test-${key}`);
}

function sectionBody(container: ParentNode, key: string): HTMLElement | null {
  return container.querySelector(`#test-${key}-body`);
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("readyEmptyCopy", () => {
  it("keeps the existing copy when nothing is blocked", () => {
    expect(readyEmptyCopy([])).toEqual({
      text: READY_EMPTY_COPY,
      href: null,
    });
  });

  it("links to Structure when blocked work is in one project", () => {
    expect(
      readyEmptyCopy([
        row(epic("blocked", false, "alpha"), {
          blocked: true,
          epicStatus: "todo",
        }),
        row(epic("blocked-2", false, "alpha"), {
          blocked: true,
          epicStatus: "todo",
        }),
      ]),
    ).toEqual({
      text: "Nothing ready. Blocked work is waiting in Structure.",
      href: projectLensPath("alpha", "structure"),
    });
  });

  it("stays general when blocked work spans several projects", () => {
    expect(
      readyEmptyCopy([
        row(epic("blocked-a", false, "alpha"), {
          blocked: true,
          epicStatus: "todo",
        }),
        row(epic("blocked-b", false, "beta"), {
          blocked: true,
          epicStatus: "todo",
        }),
      ]),
    ).toEqual({
      text: "Nothing ready. Blocked work is waiting.",
      href: null,
    });
  });
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

  it("lifts planned Ideas into needs attention", () => {
    const planned = row(idea("planned"), {
      blocked: false,
      ideaStatus: "planned",
    });
    const ready = row(epic("ready"), { blocked: false, epicStatus: "todo" });

    const partitioned = partitionCockpitBuckets(
      emptyBuckets({
        ready: [planned, ready],
      }),
    );

    expect(partitioned.needsAttention.map((item) => item.issue.id)).toEqual([
      "planned",
    ]);
    expect(partitioned.buckets.ready.map((item) => item.issue.id)).toEqual([
      "ready",
    ]);
  });

  it("orders awaiting-approval above stalled and flagged rows", () => {
    const approval = row(idea("approval"), {
      blocked: false,
      ideaStatus: "awaiting-approval",
    });
    const stalled = row(idea("stalled"), {
      blocked: false,
      ideaStatus: "awaiting-direction",
    });
    const flagged = row(epic("flagged", true), {
      blocked: false,
      epicStatus: "todo",
    });

    const partitioned = partitionCockpitBuckets(
      emptyBuckets({
        ready: [stalled, approval, flagged],
      }),
    );

    expect(partitioned.needsAttention.map((item) => item.issue.id)).toEqual([
      "approval",
      "stalled",
      "flagged",
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

  it("partitions planned Ideas into attention", () => {
    const buckets = emptyBuckets({
      ready: [
        row(idea("planned"), {
          blocked: false,
          ideaStatus: "planned",
        }),
        row(epic("ready"), { blocked: false, epicStatus: "todo" }),
      ],
    });

    const { container } = mountSections(buckets);
    expect(section(container, "needsAttention")?.textContent).toContain(
      "planned",
    );
    expect(section(container, "ready")?.textContent).toContain("ready");
    expect(section(container, "ready")?.textContent).not.toContain("planned");
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

  it("links empty Ready to Structure when blocked work is in one project", () => {
    const buckets = emptyBuckets({
      blocked: [
        row(epic("blocked", false, "alpha"), {
          blocked: true,
          epicStatus: "todo",
        }),
      ],
    });
    const { container } = mountSections(buckets);
    const ready = section(container, "ready");
    expect(ready?.textContent).toContain("Blocked work is waiting");
    const link = ready?.querySelector("a");
    expect(link?.getAttribute("href")).toBe(
      projectLensPath("alpha", "structure"),
    );
    expect(link?.textContent).toBe("Structure");
  });

  it("keeps empty Ready general when blocked work spans several projects", () => {
    const buckets = emptyBuckets({
      blocked: [
        row(epic("blocked-a", false, "alpha"), {
          blocked: true,
          epicStatus: "todo",
        }),
        row(epic("blocked-b", false, "beta"), {
          blocked: true,
          epicStatus: "todo",
        }),
      ],
    });
    const { container } = mountSections(buckets);
    const ready = section(container, "ready");
    expect(ready?.textContent).toContain("Blocked work is waiting");
    expect(ready?.querySelector("a")).toBeNull();
  });

  it("keeps the existing empty Ready copy when nothing is blocked", () => {
    const buckets = emptyBuckets({
      inFlight: [
        row(epic("flight"), { blocked: false, epicStatus: "in-progress" }),
      ],
    });
    const { container } = mountSections(buckets);
    expect(section(container, "ready")).toBeNull();
    expect(container.textContent).not.toContain("Blocked work is waiting");
  });

  it("shows five recently merged until Show all reveals the sixth", () => {
    const recentlyMerged = Array.from({ length: 6 }, (_, index) =>
      row(story(`merged-${index}`), { blocked: false, storyStatus: "merged" }),
    );
    const buckets = emptyBuckets({
      ready: [row(epic("ready"), { blocked: false, epicStatus: "todo" })],
      recentlyMerged,
    });
    const { container } = mountSections(buckets);

    expect(section(container, "inFlight")).toBeNull();

    const sectionEl = section(container, "recentlyMerged");
    expect(sectionEl).toBeTruthy();
    expect(sectionEl?.querySelector("details")).toBeNull();
    expect(sectionEl?.querySelectorAll("a")).toHaveLength(
      AWAITING_PLANNING_PREVIEW_LIMIT,
    );
    expect(sectionEl?.textContent).toContain("merged-4");
    expect(sectionEl?.textContent).not.toContain("merged-5");

    const showAll = [...(sectionEl?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent === "Show all",
    );
    expect(showAll).toBeTruthy();
    act(() => {
      showAll?.click();
    });
    expect(sectionEl?.querySelectorAll("a")).toHaveLength(6);
    expect(sectionEl?.textContent).toContain("merged-5");
    expect(sectionEl?.textContent).not.toContain("Show all");
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
    const headings = FLOW_BUCKET_HEADING_ORDER.map((label) =>
      headingLabels(container).indexOf(label),
    );
    expect(headings[0]).toBeLessThan(headings[1]);
    expect(section(container, "needsAttention")?.textContent).toContain("1");
    expect(section(container, "inFlight")?.querySelector("a")).toBeTruthy();
  });

  it("renders In flight before Ready and Awaiting planning", () => {
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
    const headings = FLOW_BUCKET_HEADING_ORDER.map((label) =>
      headingLabels(container).indexOf(label),
    );
    expect(headings[0]).toBeLessThan(headings[1]);
    expect(headings[1]).toBeLessThan(headings[2]);
    expect(headings[2]).toBeLessThan(headings[3]);

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

  it("starts with every visible section body open", () => {
    const buckets = emptyBuckets({
      ready: [row(epic("ready"), { blocked: false, epicStatus: "todo" })],
      inFlight: [
        row(epic("flight"), { blocked: false, epicStatus: "in-progress" }),
      ],
    });
    const { container } = mountSections(buckets);

    expect(sectionBody(container, "ready")).toBeTruthy();
    expect(sectionBody(container, "inFlight")).toBeTruthy();
    expect(headingButton(container, "ready")?.getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(
      headingButton(container, "inFlight")?.getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("hides only the toggled section body while keeping label and count", () => {
    const buckets = emptyBuckets({
      ready: [row(epic("ready"), { blocked: false, epicStatus: "todo" })],
      inFlight: [
        row(epic("flight"), { blocked: false, epicStatus: "in-progress" }),
      ],
    });
    const { container } = mountSections(buckets);
    const inFlightHeading = headingButton(container, "inFlight");
    expect(inFlightHeading?.textContent).toContain("In flight");
    expect(inFlightHeading?.textContent).toContain("1");
    expect(sectionBody(container, "inFlight")).toBeTruthy();

    act(() => {
      inFlightHeading?.click();
    });

    expect(inFlightHeading?.textContent).toContain("In flight");
    expect(inFlightHeading?.textContent).toContain("1");
    expect(sectionBody(container, "inFlight")).toBeNull();
    expect(sectionBody(container, "ready")).toBeTruthy();
    expect(inFlightHeading?.getAttribute("aria-expanded")).toBe("false");
  });

  it("toggles two bands independently", () => {
    const buckets = emptyBuckets({
      ready: [row(epic("ready"), { blocked: false, epicStatus: "todo" })],
      inFlight: [
        row(epic("flight"), { blocked: false, epicStatus: "in-progress" }),
      ],
    });
    const { container } = mountSections(buckets);

    act(() => {
      headingButton(container, "inFlight")?.click();
    });
    expect(sectionBody(container, "inFlight")).toBeNull();
    expect(sectionBody(container, "ready")).toBeTruthy();

    act(() => {
      headingButton(container, "ready")?.click();
    });
    expect(sectionBody(container, "inFlight")).toBeNull();
    expect(sectionBody(container, "ready")).toBeNull();

    act(() => {
      headingButton(container, "inFlight")?.click();
    });
    expect(sectionBody(container, "inFlight")).toBeTruthy();
    expect(sectionBody(container, "ready")).toBeNull();
  });

  it("hides Ready blocked-hint body when collapsed", () => {
    const buckets = emptyBuckets({
      blocked: [
        row(epic("blocked", false, "alpha"), {
          blocked: true,
          epicStatus: "todo",
        }),
      ],
    });
    const { container } = mountSections(buckets);
    const ready = section(container, "ready");
    expect(ready?.textContent).toContain("Blocked work is waiting");
    expect(sectionBody(container, "ready")).toBeTruthy();

    act(() => {
      headingButton(container, "ready")?.click();
    });

    expect(section(container, "ready")).toBeTruthy();
    expect(sectionBody(container, "ready")).toBeNull();
    expect(ready?.textContent).toContain("Ready");
    expect(ready?.textContent).not.toContain("Blocked work is waiting");
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

  it("renders cockpit rows on a bucket rail", () => {
    const items = [
      row(idea("a-0"), { blocked: false, ideaStatus: "captured" }),
      row(idea("a-1"), { blocked: false, ideaStatus: "planning" }),
    ];
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <FlowPreviewedItems
          items={items}
          asRail
          renderItem={(item) => (
            <RailNode state="ready" edge="solid">
              {item.issue.title}
            </RailNode>
          )}
        />,
      );
    });
    expect(container.querySelector('[data-testid="flow-bucket-rail"]')).toBeTruthy();
    expect(container.querySelector("ul")).toBeNull();
    expect(container.querySelectorAll('[role="listitem"]')).toHaveLength(2);
    act(() => {
      root.unmount();
    });
  });
});
