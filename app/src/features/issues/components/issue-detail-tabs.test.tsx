// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IssueDetail } from "@server/schemas";
import type { ChannelTabIndicator } from "../lib/channel-tab-indicator";
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

function mountTabs(
  indicator: ChannelTabIndicator | null = null,
  initialEntry = "/",
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
          issue={idea()}
          projectId="issue-tracker"
          overview={<div>Overview body</div>}
        />
      </MemoryRouter>,
    );
  });
  return { container, root };
}

afterEach(() => {
  document.body.innerHTML = "";
  indicatorState.value = null;
  mobileState.value = false;
  panelProps.mobileFullViewport = false;
  panelProps.onBackToOverview = undefined;
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
