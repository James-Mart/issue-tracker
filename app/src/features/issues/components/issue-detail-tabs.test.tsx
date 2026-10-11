// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IssueDetail } from "@server/schemas";
import {
  resetCockpitLaunchStore,
  useCockpitLaunchStore,
} from "../store/use-cockpit-launch-store";
import { IssueDetailTabs } from "./issue-detail-tabs";

vi.mock("../hooks/use-channel-tab-indicator", () => ({
  useChannelTabIndicator: () => null,
}));

vi.mock("../api/queries", () => ({
  useIssuesQuery: () => ({ data: { issues: [], derived: {} } }),
  useIssueAgentRunsQuery: () => ({ data: undefined }),
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("./channel-transcript-panel", () => ({
  ChannelTranscriptPanel: () => <div data-testid="channel-transcript-panel" />,
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
    archived: false,
    description: "",
    labels: [],
    version: "1",
  };
}

function mountTabs(): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter>
        <IssueDetailTabs
          issue={idea()}
          projectId="issue-tracker"
          overview={<div>Overview body</div>}
        />
      </MemoryRouter>,
    );
  });
  return container;
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
  resetCockpitLaunchStore();
});

describe("IssueDetailTabs once-only launch channel open", () => {
  it("keeps Overview after a later write while the same pending is still set", () => {
    const container = mountTabs();

    act(() => {
      useCockpitLaunchStore.getState().beginLaunch("capture", "planning");
    });
    expect(selectedTab(container)).toContain("Planning");

    act(() => {
      tabNamed(container, "Overview").click();
    });

    expect(selectedTab(container)).toContain("Overview");
    expect(useCockpitLaunchStore.getState().pending).toMatchObject({
      issueId: "capture",
      kind: "planning",
    });
  });

  it("does not switch tabs when beginLaunch is for another issue", () => {
    const container = mountTabs();

    act(() => {
      useCockpitLaunchStore.getState().beginLaunch("other", "planning");
    });

    expect(selectedTab(container)).toContain("Overview");
  });
});
