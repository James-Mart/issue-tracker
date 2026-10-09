// @vitest-environment happy-dom
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { useCockpitLaunchStore } from "../store/use-cockpit-launch-store";
import { channelSessionListItem } from "../test/channel-session-list-item";
import {
  attachmentState,
  deleteMutate,
  epic,
  idea,
  mountPanel,
  queryArgs,
  queryState,
  threadProps,
} from "./channel-transcript-panel.test-helpers";

describe("ChannelTranscriptPanel", () => {
  it("shows the planning launch empty state for an Idea with no session", () => {
    queryState.data = [];
    const { container } = mountPanel("Planning", idea);
    expect(
      container.querySelector('[data-testid="planning-channel-empty-state"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="conversation-composer"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="conversation-thread"]'),
    ).toBeNull();
  });

  it("mounts the transcript after start before the sessions list refetches", () => {
    queryState.data = [];
    const { container } = mountPanel("Planning", idea);
    act(() => {
      (
        container.querySelector(
          '[data-testid="planning-channel-empty-state"] button',
        ) as HTMLButtonElement
      ).click();
    });
    expect(queryState.data).toEqual([]);
    const thread = container.querySelector(
      '[data-testid="conversation-thread"]',
    );
    expect(thread?.getAttribute("data-conversation-id")).toBe("new-session");
    expect(
      container.querySelector('[data-testid="planning-channel-empty-state"]'),
    ).toBeNull();
  });

  it("shows generic ShellState when the channel has no session and no Idea context", () => {
    queryState.data = [];
    const { container } = mountPanel();
    expect(container.textContent).toContain("No planning session.");
    expect(container.textContent).toContain(
      "This channel is for planning work on this issue.",
    );
    expect(
      container.querySelector('[data-testid="planning-channel-empty-state"]'),
    ).toBeNull();
  });

  it("keeps the waiting panel until the launch session appears, then shows that transcript", () => {
    queryState.data = [
      channelSessionListItem({ id: "older", createdAt: "2020-01-01T00:00:00.000Z" }),
    ];
    const { container, rerender } = mountPanel("Planning", idea);

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

  it("keeps the resumed session's transcript up while the resume request is pending", () => {
    queryState.data = [
      channelSessionListItem({
        id: "sess-1",
        title: "Implement Ship it",
        createdAt: "2020-01-01T00:00:00.000Z",
      }),
    ];
    const { container } = mountPanel("Implementing", epic, {
      channel: "implementing",
      projectId: "platform",
    });

    act(() => {
      useCockpitLaunchStore.getState().beginLaunch("ship-it", "work", {
        resumeSession: {
          id: "sess-1",
          title: "Implement Ship it",
          model: "composer-2.5",
        },
      });
    });

    expect(
      container.querySelector('[data-testid="channel-launch-pending"]'),
    ).toBeNull();
    expect(
      container
        .querySelector('[data-testid="conversation-thread"]')
        ?.getAttribute("data-conversation-id"),
    ).toBe("sess-1");
    expect(queryArgs.awaitingLaunchSession).toBe(false);
  });

  it("shows the launch error with the live transcript when that launch then fails", () => {
    queryState.data = [
      channelSessionListItem({
        id: "older",
        createdAt: "2020-01-01T00:00:00.000Z",
      }),
    ];
    const { container, rerender } = mountPanel("Planning", idea);

    act(() => {
      useCockpitLaunchStore.getState().beginLaunch("capture", "planning");
    });
    const startedAt = useCockpitLaunchStore.getState().pending?.startedAt ?? "";
    queryState.data = [
      channelSessionListItem({
        id: "older",
        createdAt: "2020-01-01T00:00:00.000Z",
      }),
      channelSessionListItem({
        id: "live-1",
        title: "Plan Capture",
        createdAt: startedAt,
        activeRun: true,
      }),
    ];
    rerender();

    expect(
      container
        .querySelector('[data-testid="conversation-thread"]')
        ?.getAttribute("data-conversation-id"),
    ).toBe("live-1");
    expect(
      container.querySelector('[data-testid="channel-launch-fault"]'),
    ).toBeNull();

    act(() => {
      useCockpitLaunchStore.getState().failLaunch("capture", "planning", {
        errorMessage: "upstream refused",
      });
    });

    expect(
      container.querySelector('[data-testid="channel-launch-pending"]'),
    ).toBeNull();
    expect(
      container
        .querySelector('[data-testid="conversation-thread"]')
        ?.getAttribute("data-conversation-id"),
    ).toBe("live-1");
    const fault = container.querySelector('[data-testid="channel-launch-fault"]');
    expect(fault?.textContent).toContain(
      "Session create rejected — upstream refused.",
    );
    expect(fault?.textContent).toContain("Start the planning session again.");
  });

  it("shows the launch error with the resumed transcript when the resume request fails", () => {
    queryState.data = [
      channelSessionListItem({
        id: "sess-1",
        title: "Implement Ship it",
        createdAt: "2020-01-01T00:00:00.000Z",
      }),
    ];
    const { container } = mountPanel("Implementing", epic, {
      channel: "implementing",
      projectId: "platform",
    });

    act(() => {
      useCockpitLaunchStore.getState().beginLaunch("ship-it", "work", {
        resumeSession: {
          id: "sess-1",
          title: "Implement Ship it",
          model: "composer-2.5",
        },
      });
    });
    act(() => {
      useCockpitLaunchStore.getState().failLaunch("ship-it", "work", {
        errorMessage: "upstream refused",
      });
    });

    expect(
      container.querySelector('[data-testid="channel-launch-pending"]'),
    ).toBeNull();
    expect(
      container
        .querySelector('[data-testid="conversation-thread"]')
        ?.getAttribute("data-conversation-id"),
    ).toBe("sess-1");
    expect(
      container.querySelector('[data-testid="channel-launch-fault"]')?.textContent,
    ).toContain("Start the work loop again.");
  });

  it("shows the launch error with the older transcript when the new session never appears", () => {
    queryState.data = [
      channelSessionListItem({
        id: "older",
        createdAt: "2020-01-01T00:00:00.000Z",
      }),
    ];
    const { container } = mountPanel("Planning", idea);

    act(() => {
      useCockpitLaunchStore.getState().beginLaunch("capture", "planning");
    });
    expect(
      container.querySelector('[data-testid="channel-launch-pending"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="conversation-thread"]'),
    ).toBeNull();

    act(() => {
      useCockpitLaunchStore.getState().failLaunch("capture", "planning", {
        errorMessage: "upstream refused",
      });
    });

    expect(
      container.querySelector('[data-testid="channel-launch-pending"]'),
    ).toBeNull();
    expect(
      container
        .querySelector('[data-testid="conversation-thread"]')
        ?.getAttribute("data-conversation-id"),
    ).toBe("older");
    expect(
      container.querySelector('[data-testid="channel-launch-fault"]')?.textContent,
    ).toContain("Start the planning session again.");
  });

  it("shows the launch error on the empty channel when the launch fails", () => {
    queryState.data = [];
    const { container } = mountPanel("Implementing", epic, {
      channel: "implementing",
      projectId: "platform",
    });

    act(() => {
      useCockpitLaunchStore.getState().beginLaunch("ship-it", "work");
    });
    expect(
      container.querySelector('[data-testid="channel-launch-pending"]'),
    ).toBeTruthy();

    act(() => {
      useCockpitLaunchStore.getState().failLaunch("ship-it", "work", {
        errorMessage: "upstream refused",
      });
    });

    expect(
      container.querySelector('[data-testid="channel-launch-pending"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="conversation-thread"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="implementing-channel-empty-state"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="channel-launch-fault"]')?.textContent,
    ).toContain("Start the work loop again.");
  });

  it("hosts ConversationThread for the most recent non-archived session", () => {
    queryState.data = [
      {
        id: "archived-newer",
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
        title: "Live plan",
        model: "composer-2.5-fast",
        createdAt: "2026-08-02T00:00:00.000Z",
        updatedAt: "2026-08-02T00:00:00.000Z",
        archived: false,
        activeRun: false,
        awaitingHuman: false,
      },
    ];
    const { container } = mountPanel("Planning", idea);
    const thread = container.querySelector(
      '[data-testid="conversation-thread"]',
    );
    expect(thread?.getAttribute("data-conversation-id")).toBe("live");
    expect(thread?.getAttribute("data-model")).toBe("composer-2.5-fast");
    expect(
      container.querySelector('[data-testid="channel-transcript-panel"]'),
    ).toBeTruthy();
  });

  it("exposes delete without the session select when the channel has one session", () => {
    queryState.data = [
      {
        id: "only",
        title: "Solo",
        model: "composer-2.5-fast",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
        archived: false,
        activeRun: false,
        awaitingHuman: false,
      },
    ];
    const { container } = mountPanel("Planning", idea);
    expect(
      container.querySelector('[data-testid="channel-session-switcher"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="channel-session-select"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="pick-session-only"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="channel-session-delete"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="planning-new-run"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="channel-retro"]'),
    ).toBeTruthy();
  });

  it("renders the session switcher when the channel has two sessions", () => {
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
      container.querySelector('[data-testid="channel-session-switcher"]'),
    ).toBeTruthy();
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
    expect(threadProps.hideComposer).toBe(false);

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

  it("shows the implementing launch empty state for an Epic with no session", () => {
    queryState.data = [];
    const { container } = mountPanel("Implementing", epic, {
      channel: "implementing",
      projectId: "platform",
    });
    expect(
      container.querySelector('[data-testid="implementing-channel-empty-state"]'),
    ).toBeTruthy();
  });

  it("names the Implementing channel in the generic empty state without a work root", () => {
    queryState.data = [];
    const { container } = mountPanel("Implementing");
    expect(container.textContent).toContain("No implementing session.");
    expect(container.textContent).toContain(
      "This channel is for implementing work on this issue.",
    );
  });

  it("shares mobile full-viewport chrome for empty and active sessions", () => {
    const onBack = vi.fn();
    queryState.data = [];
    const empty = mountPanel("Planning", idea, {
      mobileFullViewport: true,
      onBackToOverview: onBack,
    });
    expect(
      empty.container
        .querySelector("[data-testid='channel-transcript-panel']")
        ?.getAttribute("data-mobile-full-viewport"),
    ).toBe("true");
    expect(
      empty.container.querySelector('[data-testid="open-thread-chrome"]'),
    ).toBeTruthy();
    expect(
      empty.container.querySelector('[data-testid="planning-channel-empty-state"]'),
    ).toBeTruthy();
    act(() => {
      (
        empty.container.querySelector(
          '[aria-label="Back to overview"]',
        ) as HTMLButtonElement
      ).click();
    });
    expect(onBack).toHaveBeenCalledTimes(1);

    queryState.data = [
      {
        id: "live",
        title: "Live plan",
        model: "composer-2.5-fast",
        createdAt: "2026-08-02T00:00:00.000Z",
        updatedAt: "2026-08-02T00:00:00.000Z",
        archived: false,
        activeRun: true,
        awaitingHuman: false,
      },
    ];
    const active = mountPanel("Planning", idea, {
      mobileFullViewport: true,
      onBackToOverview: onBack,
    });
    expect(
      active.container.querySelector('[data-testid="channel-panel-header"]'),
    ).toBeNull();
    expect(
      active.container.querySelector('[data-testid="channel-session-switcher"]'),
    ).toBeTruthy();
    expect(
      active.container.querySelector('[data-testid="channel-session-delete"]'),
    ).toBeTruthy();
    expect(
      active.container.querySelector('[data-testid="pick-session-live"]'),
    ).toBeNull();
    expect(threadProps.onBack).toBeTypeOf("function");
    expect(threadProps.headerActions).toBe(true);
    expect(
      active.container.querySelector(
        '[data-testid="channel-session-overflow-menu"]',
      ),
    ).toBeTruthy();
    expect(
      active.container.querySelector('[data-testid="thread-status-strip"]'),
    ).toBeTruthy();
  });

  it("exposes session actions from the mobile overflow menu", () => {
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
    const { container } = mountPanel("Planning", idea, {
      mobileFullViewport: true,
      onBackToOverview: () => undefined,
    });
    expect(
      container.querySelector('[data-testid="channel-session-overflow-menu"]'),
    ).toBeTruthy();
    // Overflow content is portaled; assert the actions are mounted as children
    // of the trigger's menu (present in the tree even before open in jsdom).
    expect(threadProps.headerActions).toBe(true);
    expect(
      container.querySelector('[data-testid="channel-session-switcher"]') ??
        document.querySelector('[data-testid="channel-session-switcher"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="planning-new-run"]') ??
        document.querySelector('[data-testid="planning-new-run"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="channel-retro"]') ??
        document.querySelector('[data-testid="channel-retro"]'),
    ).toBeTruthy();
  });

  it("returns to the planning empty state after deleting the last session", () => {
    const soloSession = {
      id: "only",
      title: "Solo",
      model: "composer-2.5-fast",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
      archived: false,
      activeRun: false,
      awaitingHuman: false,
    };
    queryState.data = [soloSession];
    const { container, rerender } = mountPanel("Planning", idea);

    deleteMutate.mockImplementation((_id, options) => {
      queryState.data = [];
      options?.onSuccess?.();
      rerender();
    });

    act(() => {
      (
        container.querySelector(
          '[data-testid="channel-session-delete"]',
        ) as HTMLButtonElement
      ).click();
    });

    expect(deleteMutate).toHaveBeenCalledWith("only", expect.any(Object));
    expect(
      container.querySelector('[data-testid="planning-channel-empty-state"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="conversation-thread"]'),
    ).toBeNull();
  });

  it("renders the export transcript instead of crashing on the current session", () => {
    queryState.data = [
      {
        id: "exp-1",
        title: "Export Ship it",
        model: "composer-2.5",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
        archived: false,
        activeRun: true,
        awaitingHuman: false,
      },
    ];
    const { container } = mountPanel("Export", epic, { channel: "export" });
    const thread = container.querySelector('[data-testid="conversation-thread"]');
    expect(thread?.getAttribute("data-conversation-id")).toBe("exp-1");
    expect(thread?.getAttribute("data-composer-disabled")).toBe("true");
    expect(container.textContent).not.toContain("This view crashed");
    expect(
      container.querySelector('[data-testid="export-review-workbench"]'),
    ).toBeNull();
  });

  it("switches the export tab from the transcript page to the workbench when drafts exist", () => {
    attachmentState.data = [{ name: "github-export-ship-it.md" }];
    queryState.data = [
      {
        id: "exp-1",
        title: "Export Ship it",
        model: "composer-2.5",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
        archived: false,
        activeRun: false,
        awaitingHuman: false,
      },
    ];
    const { container } = mountPanel("Export", epic, { channel: "export" });
    expect(
      container.querySelector('[data-testid="export-review-workbench"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="conversation-thread"]'),
    ).toBeNull();
  });

  it("exposes delete for a single session from the mobile overflow menu", () => {
    queryState.data = [
      {
        id: "only",
        title: "Solo",
        model: "composer-2.5-fast",
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
        archived: false,
        activeRun: false,
        awaitingHuman: false,
      },
    ];
    const { container } = mountPanel("Planning", idea, {
      mobileFullViewport: true,
      onBackToOverview: () => undefined,
    });
    expect(
      container.querySelector('[data-testid="channel-session-overflow-menu"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="channel-session-delete"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="pick-session-only"]'),
    ).toBeNull();
  });
});
