// @vitest-environment happy-dom
import { act } from "react";
import { describe, expect, it } from "vitest";
import { useCockpitLaunchStore } from "../store/use-cockpit-launch-store";
import { channelSessionListItem } from "../test/channel-session-list-item";
import {
  idea,
  mountPanel,
  queryArgs,
  queryState,
} from "./channel-transcript-panel.test-helpers";

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
        model: "composer-2.5-fast",
        createdAt: "2026-08-03T00:00:00.000Z",
        updatedAt: "2026-08-03T00:00:00.000Z",
        archived: true,
        activeRun: false,
        awaitingHuman: false,
      },
      {
        id: "live",
        title: "Live",
        model: "composer-2.5-fast",
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
});
