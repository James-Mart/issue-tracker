// @vitest-environment happy-dom
import { act } from "react";
import { describe, expect, it } from "vitest";
import type { IssueDetail, IssueRecord } from "@server/schemas";
import { useCockpitLaunchStore } from "../store/use-cockpit-launch-store";
import { channelSessionListItem } from "../test/channel-session-list-item";
import {
  idea,
  issuesState,
  mountPanel,
  queryArgs,
  queryState,
} from "./channel-transcript-panel.test-helpers";

const t = "2026-08-01T00:00:00.000Z";

const project: IssueRecord = {
  kind: "project",
  id: "platform",
  title: "Platform",
  trunk: "main",
  mergePolicy: "manual",
  maxImplementingRuns: 1,
  order: 0,
  createdAt: t,
  updatedAt: t,
};

const outline: Extract<IssueDetail, { kind: "outline" }> = {
  kind: "outline",
  id: "spec",
  title: "Feature outline",
  partOf: "platform",
  bodyVersion: 3,
  archived: false,
  order: 0,
  createdAt: t,
  updatedAt: t,
  description: "",
  version: "1",
};

const concludedOutline: IssueRecord = {
  kind: "outline",
  id: "spec",
  title: "Feature outline",
  partOf: "platform",
  bodyVersion: 1,
  sourceIdea: "capture",
  concludedAt: "2026-08-02T00:00:00.000Z",
  archived: false,
  order: 0,
  createdAt: t,
  updatedAt: t,
};

describe("ChannelTranscriptPanel", () => {
  it("keeps the waiting panel until the launch session appears, then shows that transcript", () => {
    queryState.data = [
      channelSessionListItem({ id: "older", createdAt: "2020-01-01T00:00:00.000Z" }),
    ];
    const { container, rerender } = mountPanel(idea);

    act(() => {
      useCockpitLaunchStore.getState().beginLaunch("capture", "planning");
    });

    expect(
      container.querySelector('[data-testid="channel-launch-pending"]')
        ?.textContent,
    ).toContain("The transcript opens here as soon as the session appears.");
    expect(
      container.querySelector('[data-testid="conversation-thread"]'),
    ).toBeNull();
    expect(queryArgs.awaitingLaunchSession).toBe(true);

    const startedAt = useCockpitLaunchStore.getState().pending?.startedAt ?? "";
    queryState.data = [
      channelSessionListItem({ id: "older", createdAt: "2020-01-01T00:00:00.000Z" }),
      channelSessionListItem({
        id: "live-1",
        title: "Plan Capture",
        createdAt: startedAt,
        activeRun: true,
      }),
    ];
    rerender();

    expect(
      container.querySelector('[data-testid="channel-launch-pending"]'),
    ).toBeNull();
    expect(
      container
        .querySelector('[data-testid="conversation-thread"]')
        ?.getAttribute("data-conversation-id"),
    ).toBe("live-1");
    expect(useCockpitLaunchStore.getState().pending).toMatchObject({
      issueId: "capture",
      kind: "planning",
    });
  });

  it("hides the composer when an archived session is selected", () => {
    queryState.data = [
      {
        id: "archived",
        title: "Old",
        model: "composer-2.5",
        createdAt: "2026-08-03T00:00:00.000Z",
        updatedAt: "2026-08-03T00:00:00.000Z",
        archived: true,
        activeRun: false,
        awaitingHuman: false,
      },
      {
        id: "live",
        title: "Live",
        model: "composer-2.5",
        createdAt: "2026-08-02T00:00:00.000Z",
        updatedAt: "2026-08-02T00:00:00.000Z",
        archived: false,
        activeRun: false,
        awaitingHuman: false,
      },
    ];
    const { container } = mountPanel();
    expect(
      container
        .querySelector('[data-testid="conversation-thread"]')
        ?.getAttribute("data-hide-composer"),
    ).toBe("false");

    act(() => {
      (
        container.querySelector(
          '[data-testid="pick-session-archived"]',
        ) as HTMLButtonElement
      ).click();
    });

    const thread = container.querySelector(
      '[data-testid="conversation-thread"]',
    );
    expect(thread?.getAttribute("data-conversation-id")).toBe("archived");
    expect(thread?.getAttribute("data-hide-composer")).toBe("true");
  });

  it("opens the concluded banner on the outline's planner sessions", () => {
    issuesState.data = { issues: [project, concludedOutline] };
    queryState.data = [
      channelSessionListItem({
        id: "planner",
        archived: false,
        createdAt: "2026-08-02T00:00:00.000Z",
      }),
    ];
    const { container } = mountPanel({ ...idea, archived: true });

    const banner = container.querySelector(
      '[data-testid="planning-concluded-banner"]',
    );
    const link = banner?.querySelector("a");
    expect(banner?.textContent).toContain("Planning concluded");
    expect(banner?.textContent).toContain("Feature outline");
    expect(link?.getAttribute("href")).toBe(
      "/projects/platform/issues/spec?tab=planning",
    );
    expect(container.textContent).not.toContain("Archived session");
    expect(
      container.querySelector('[data-testid="planning-read-only"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="planning-new-run"]'),
    ).toBeNull();
    expect(
      container
        .querySelector('[data-testid="conversation-thread"]')
        ?.getAttribute("data-hide-composer"),
    ).toBe("true");
  });

  it("says the other channel is live once, above the composer, and links the run", () => {
    queryState.byChannel = {
      planning: [channelSessionListItem({ id: "planner", title: "Plan spec" })],
      decomposition: [
        channelSessionListItem({
          id: "decomposer",
          outlineRole: "decomposer",
          title: "Decompose spec",
          activeRun: true,
        }),
      ],
    };
    const { container } = mountPanel(outline, { projectId: "platform" });

    const notes = container.querySelectorAll(
      '[data-testid="outline-channel-busy"]',
    );
    expect(notes).toHaveLength(1);
    const note = notes[0];
    expect(note?.textContent).toContain(
      "Composer paused while Decomposition run",
    );
    expect(note?.textContent).toContain("Decompose spec");
    expect(note?.textContent).toContain("is live on this outline.");
    expect(note?.querySelector("a")?.getAttribute("href")).toBe(
      "/projects/platform/issues/spec?tab=decomposition",
    );
    const thread = container.querySelector(
      '[data-testid="conversation-thread"]',
    );
    expect(thread?.contains(note!)).toBe(true);
    expect(thread?.getAttribute("data-composer-disabled")).toBe("true");
    expect(
      (
        container.querySelector(
          '[data-testid="outline-new-planning-session"]',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(container.textContent).not.toContain("Sessions");
  });
});
