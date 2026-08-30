// @vitest-environment happy-dom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IssueDetail } from "@server/schemas";
import type { ChannelTabIndicator } from "../lib/channel-tab-indicator";
import {
  resetCockpitLaunchStore,
  useCockpitLaunchStore,
} from "../store/use-cockpit-launch-store";
import { IssueDetailTabs } from "./issue-detail-tabs";

const indicatorState = vi.hoisted(() => ({
  value: null as ChannelTabIndicator | null,
}));

const mobileState = vi.hoisted(() => ({
  value: false,
}));

const panelProps = vi.hoisted(() => ({
  mobileFullViewport: false,
  onBackToOverview: undefined as (() => void) | undefined,
  mounted: false,
}));

vi.mock("../hooks/use-channel-tab-indicator", () => ({
  useChannelTabIndicator: () => indicatorState.value,
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => mobileState.value,
}));

vi.mock("./channel-transcript-panel", () => ({
  ChannelTranscriptPanel: ({
    mobileFullViewport,
    onBackToOverview,
  }: {
    mobileFullViewport?: boolean;
    onBackToOverview?: () => void;
  }) => {
    useEffect(() => {
      panelProps.mounted = true;
      return () => {
        panelProps.mounted = false;
        panelProps.mobileFullViewport = false;
        panelProps.onBackToOverview = undefined;
      };
    }, []);
    panelProps.mobileFullViewport = Boolean(mobileFullViewport);
    panelProps.onBackToOverview = onBackToOverview;
    return (
      <div data-testid="channel-transcript-panel">
        {onBackToOverview ? (
          <button type="button" onClick={onBackToOverview}>
            Back
          </button>
        ) : null}
      </div>
    );
  },
}));

vi.mock("./supporting-doc-preview", () => ({
  SupportingDocPreview: () => <div data-testid="supporting-doc-preview" />,
}));

const t0 = "2026-08-01T00:00:00.000Z";

function idea(): IssueDetail {
  return {
    id: "capture",
    kind: "idea",
    title: "Capture",
    partOf: "issue-tracker",
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    blockedBy: [],
    archived: false,
    description: "",
    labels: [],
  };
}

function epic(): IssueDetail {
  return {
    id: "auth",
    kind: "epic",
    title: "Auth",
    partOf: "issue-tracker",
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    blockedBy: [],
    archived: false,
    description: "",
    labels: [],
    needsAttention: false,
    attentionReason: null,
  };
}

function mountTabs(
  indicator: ChannelTabIndicator | null = null,
  initialEntry = "/",
  issue: IssueDetail = idea(),
): {
  container: HTMLDivElement;
  root: Root;
} {
  indicatorState.value = indicator;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <IssueDetailTabs
          issue={issue}
          projectId="issue-tracker"
          overview={<div>Overview body</div>}
        />
      </MemoryRouter>,
    );
  });
  return { container, root };
}

function selectedTab(container: ParentNode): string | undefined {
  return Array.from(container.querySelectorAll('[role="tab"]'))
    .find((tab) => tab.getAttribute("aria-selected") === "true")
    ?.textContent?.trim();
}

function tabNamed(container: ParentNode, label: string): HTMLButtonElement {
  return Array.from(container.querySelectorAll('[role="tab"]')).find((el) =>
    el.textContent?.includes(label),
  ) as HTMLButtonElement;
}

afterEach(() => {
  document.body.innerHTML = "";
  indicatorState.value = null;
  mobileState.value = false;
  panelProps.mobileFullViewport = false;
  panelProps.onBackToOverview = undefined;
  panelProps.mounted = false;
  resetCockpitLaunchStore();
});

describe("IssueDetailTabs channel panel mount", () => {
  it("does not mount the channel panel while Overview is selected", () => {
    const { container } = mountTabs(null, "/");
    expect(panelProps.mounted).toBe(false);
    expect(
      container.querySelector('[data-testid="channel-transcript-panel"]'),
    ).toBeNull();
  });

  it("mounts the channel panel only for the selected channel tab", () => {
    const { container } = mountTabs(null, "/?tab=planning");
    expect(panelProps.mounted).toBe(true);
    expect(
      container.querySelector('[data-testid="channel-transcript-panel"]'),
    ).toBeTruthy();
  });

  it("unmounts the channel panel when leaving the channel tab", () => {
    const { container } = mountTabs(null, "/?tab=planning");
    expect(panelProps.mounted).toBe(true);

    act(() => {
      (
        Array.from(container.querySelectorAll('[role="tab"]')).find((el) =>
          el.textContent?.includes("Overview"),
        ) as HTMLButtonElement
      ).click();
    });

    expect(panelProps.mounted).toBe(false);
    expect(
      container.querySelector('[data-testid="channel-transcript-panel"]'),
    ).toBeNull();
  });
});

describe("IssueDetailTabs channel indicator", () => {
  it("shows the pulsing run dot and not the warn accent while active", () => {
    const { container } = mountTabs("active-run");
    const tab = container.querySelector('[data-channel-tab-indicator="active-run"]');
    expect(tab).toBeTruthy();
    expect(tab?.textContent).toContain("Planning");
    expect(
      container.querySelector('[data-testid="roster-active-run"]'),
    ).toBeTruthy();
    expect(tab?.className).not.toContain("--warning");
  });

  it("takes the warn accent when awaiting the human", () => {
    const { container } = mountTabs("awaiting-human");
    const tab = container.querySelector(
      '[data-channel-tab-indicator="awaiting-human"]',
    );
    expect(tab).toBeTruthy();
    expect(tab?.className).toContain("--warning");
    expect(
      container.querySelector('[data-testid="roster-active-run"]'),
    ).toBeNull();
  });

  it("shows neither decoration when the indicator is quiet", () => {
    const { container } = mountTabs(null);
    const planning = Array.from(container.querySelectorAll('[role="tab"]')).find(
      (el) => el.textContent?.includes("Planning"),
    );
    expect(planning).toBeTruthy();
    expect(planning?.getAttribute("data-channel-tab-indicator")).toBeNull();
    expect(
      container.querySelector('[data-testid="roster-active-run"]'),
    ).toBeNull();
    expect(planning?.className).not.toContain("--warning");
  });
});

describe("IssueDetailTabs once-only launch channel open", () => {
  it("selects Planning when beginLaunch runs from Overview", () => {
    const { container } = mountTabs(null, "/");
    expect(selectedTab(container)).toContain("Overview");

    act(() => {
      useCockpitLaunchStore.getState().beginLaunch("capture", "planning");
    });

    expect(selectedTab(container)).toContain("Planning");
    expect(useCockpitLaunchStore.getState().pending).toEqual({
      issueId: "capture",
      kind: "planning",
    });
  });

  it("selects Implementing when beginLaunch runs a work launch from Overview", () => {
    const { container } = mountTabs(null, "/", epic());
    expect(selectedTab(container)).toContain("Overview");

    act(() => {
      useCockpitLaunchStore.getState().beginLaunch("auth", "work");
    });

    expect(selectedTab(container)).toContain("Implementing");
  });

  it("keeps Overview after a later write while the same pending is still set", () => {
    const { container } = mountTabs(null, "/");

    act(() => {
      useCockpitLaunchStore.getState().beginLaunch("capture", "planning");
    });
    expect(selectedTab(container)).toContain("Planning");

    act(() => {
      tabNamed(container, "Overview").click();
    });

    expect(selectedTab(container)).toContain("Overview");
    expect(useCockpitLaunchStore.getState().pending).toEqual({
      issueId: "capture",
      kind: "planning",
    });
  });

  it("does not switch tabs when beginLaunch is for another issue", () => {
    const { container } = mountTabs(null, "/");

    act(() => {
      useCockpitLaunchStore.getState().beginLaunch("other", "planning");
    });

    expect(selectedTab(container)).toContain("Overview");
  });
});

describe("IssueDetailTabs mobile channel chrome", () => {
  it("hides the tab bar on a mobile channel tab and wires Back to Overview", () => {
    mobileState.value = true;
    const { container } = mountTabs(null, "/?tab=planning");
    expect(container.querySelector('[role="tablist"]')).toBeNull();
    expect(panelProps.mobileFullViewport).toBe(true);
    expect(panelProps.onBackToOverview).toBeTypeOf("function");

    act(() => {
      (container.querySelector("button") as HTMLButtonElement).click();
    });
    expect(container.querySelector('[role="tablist"]')).toBeTruthy();
    expect(container.textContent).toContain("Overview body");
    expect(panelProps.mobileFullViewport).toBe(false);
  });

  it("keeps the tab bar on mobile Overview", () => {
    mobileState.value = true;
    const { container } = mountTabs(null, "/");
    expect(container.querySelector('[role="tablist"]')).toBeTruthy();
    expect(panelProps.mobileFullViewport).toBe(false);
  });
});
