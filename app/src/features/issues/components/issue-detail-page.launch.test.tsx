// @vitest-environment happy-dom
import { act } from "react";
import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { channelSessionListItem } from "../test/channel-session-list-item";
import { useCockpitLaunchStore } from "../store/use-cockpit-launch-store";
import {
  epicDetail,
  epicRecord,
  ideaDetail,
  ideaRecord,
  liveRunConfirm,
  mockState,
  mountDetail,
  mutate,
  mutateOptions,
  ownFlowIndex,
  project,
  remount,
  selectedTab,
  sendMessageMutate,
  sendMessageOptions,
  storyDetail,
  storyRecord,
  taskRecord,
  workLoopControlIndex,
} from "./issue-detail-page.launch.test-helpers";


describe("Issue detail launch — Epic implementing", () => {
  function seedEpic(): void {
    mockState.issue = epicDetail("auth-hardening", "p-a", "Auth hardening");
    mockState.issues = [
      project("p-a"),
      epicRecord("auth-hardening", "p-a", "Auth hardening"),
    ];
    mockState.derived = {
      "auth-hardening": { blocked: false, epicStatus: "todo" },
    };
  }

  it("flips top bar, chip, tab live, run strip, and starting body together on click", () => {
    seedEpic();
    const { container } = mountDetail(
      "/projects/p-a/issues/auth-hardening?tab=implementing",
    );

    expect(
      container.querySelectorAll('[data-testid="implementing-start-session"]')
        .length,
    ).toBe(1);

    act(() => {
      (
        container.querySelector(
          '[data-testid="implementing-start-session"]',
        ) as HTMLButtonElement
      ).click();
    });

    expect(container.querySelector('[data-live="true"]')?.textContent).toContain(
      "agents on the line",
    );
    expect(container.textContent).toContain("in progress");
    expect(
      container.querySelector('[data-channel-tab-indicator="active-run"]')
        ?.textContent,
    ).toContain("Implementing");
    expect(
      container.querySelector('[data-testid="thread-status-strip"]')
        ?.textContent,
    ).toContain("running");
    expect(
      container.querySelector('[data-testid="channel-launch-pending"]')
        ?.textContent,
    ).toContain("Starting the work loop…");
    expect(
      container.querySelector('[data-testid="channel-launch-pending"]')
        ?.textContent,
    ).toContain("The transcript opens here as soon as the session appears.");
  });

  it("shows the new session transcript while session-create is still pending", () => {
    seedEpic();
    const { container, root } = mountDetail(
      "/projects/p-a/issues/auth-hardening?tab=implementing",
    );
    act(() => {
      (
        container.querySelector(
          '[data-testid="implementing-start-session"]',
        ) as HTMLButtonElement
      ).click();
    });
    const startedAt = useCockpitLaunchStore.getState().pending?.startedAt;
    expect(startedAt).toBeTruthy();
    mockState.sessions = [
      channelSessionListItem({
        id: "sess-live",
        createdAt: startedAt,
        activeRun: true,
      }),
    ];
    remount(root, "/projects/p-a/issues/auth-hardening?tab=implementing");

    expect(mutateOptions().onSuccess).toBeTypeOf("function");
    expect(
      container.querySelector('[data-testid="channel-launch-pending"]'),
    ).toBeNull();
    expect(
      container
        .querySelector('[data-testid="conversation-thread"]')
        ?.getAttribute("data-conversation-id"),
    ).toBe("sess-live");
    expect(useCockpitLaunchStore.getState().pending?.issueId).toBe(
      "auth-hardening",
    );
  });

  it("shows the session thread on session-create ack", () => {
    seedEpic();
    const { container } = mountDetail(
      "/projects/p-a/issues/auth-hardening?tab=implementing",
    );
    act(() => {
      (
        container.querySelector(
          '[data-testid="implementing-start-session"]',
        ) as HTMLButtonElement
      ).click();
    });
    act(() => {
      mutateOptions().onSuccess?.({ id: "sess-1" });
    });

    expect(
      container.querySelector('[data-testid="conversation-thread"]')
        ?.textContent,
    ).toContain("session thread");
    expect(
      container
        .querySelector('[data-testid="conversation-thread"]')
        ?.getAttribute("data-conversation-id"),
    ).toBe("sess-1");
    expect(container.querySelector('[data-live="true"]')?.textContent).toContain(
      "agents on the line",
    );
  });

  it("restores the quiet ready instrument with a named 409 fault", () => {
    seedEpic();
    mockState.issues = [
      project("p-a"),
      epicRecord("auth-hardening", "p-a", "Auth hardening"),
      epicRecord("push", "p-a", "Push notifications"),
    ];
    const { container } = mountDetail(
      "/projects/p-a/issues/auth-hardening?tab=implementing",
    );
    act(() => {
      (
        container.querySelector(
          '[data-testid="implementing-start-session"]',
        ) as HTMLButtonElement
      ).click();
    });
    act(() => {
      mutateOptions().onError?.(
        new ApiError("conflict", 409, {
          error: "locked",
          holderIssueId: "push",
          holderIssueTitle: "Push notifications",
        }),
      );
    });

    expect(container.querySelector('[data-live="false"]')?.textContent).toContain(
      "all quiet",
    );
    expect(container.textContent).toContain("todo");
    expect(container.textContent).not.toContain("in progress");
    expect(
      container.querySelector('[data-channel-tab-indicator="active-run"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="channel-launch-pending"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="implementing-start-session"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="channel-launch-fault"]')
        ?.textContent,
    ).toContain(
      "Session create rejected — implementing lock held by Push notifications (409).",
    );
  });

  it("selects Implementing immediately when launched from Overview", () => {
    seedEpic();
    const { container } = mountDetail("/projects/p-a/issues/auth-hardening");
    expect(selectedTab(container)).toContain("Overview");

    expect(
      container.querySelector('[data-testid="issue-overview-launch"]'),
    ).toBeNull();
    expect(
      container.querySelectorAll(
        '[data-testid="implementing-overview-start-session"]',
      ).length,
    ).toBe(1);
    expect(
      container.querySelector('[data-testid="implementing-start-session"]'),
    ).toBeNull();
    expect(workLoopControlIndex(container)).toBeGreaterThan(ownFlowIndex(container));

    act(() => {
      (
        container.querySelector(
          '[data-testid="implementing-overview-start-session"]',
        ) as HTMLButtonElement
      ).click();
    });

    expect(selectedTab(container)).toContain("Implementing");
    expect(
      container.querySelector('[data-testid="channel-launch-pending"]')
        ?.textContent,
    ).toContain("Starting the work loop…");
  });

  it("hides the post-rail control while liveRun is true", () => {
    seedEpic();
    mockState.derived = {
      "auth-hardening": { blocked: false, epicStatus: "in-progress", liveRun: true },
    };
    const { container } = mountDetail("/projects/p-a/issues/auth-hardening");
    expect(
      container.querySelector('[data-testid="post-rail-work-loop"]'),
    ).toBeNull();
  });

  it("hides the post-rail control when every leaf task is done", () => {
    seedEpic();
    mockState.issues = [
      project("p-a"),
      epicRecord("auth-hardening", "p-a", "Auth hardening"),
      storyRecord("story-1", "auth-hardening", "Story one"),
      taskRecord("task-1", "story-1", "done"),
    ];
    mockState.sessions = [channelSessionListItem({ id: "sess-1" })];
    const { container } = mountDetail("/projects/p-a/issues/auth-hardening");
    expect(
      container.querySelector('[data-testid="post-rail-work-loop"]'),
    ).toBeNull();
  });

  it("resumes the current session from Overview below the rail", () => {
    seedEpic();
    mockState.issues = [
      project("p-a"),
      epicRecord("auth-hardening", "p-a", "Auth hardening"),
      storyRecord("story-1", "auth-hardening", "Story one"),
      taskRecord("task-1", "story-1", "todo"),
    ];
    mockState.sessions = [
      channelSessionListItem({
        id: "sess-1",
        title: "Implement Auth hardening",
        updatedAt: "2026-09-09T10:00:00.000Z",
      }),
    ];
    const { container } = mountDetail("/projects/p-a/issues/auth-hardening");

    expect(workLoopControlIndex(container)).toBeGreaterThan(ownFlowIndex(container));
    expect(
      container.querySelector('[data-testid="implementing-overview-resume-session"]')
        ?.textContent,
    ).toContain("Resume work loop");
    expect(
      container.querySelector('[data-testid="work-loop-session-ref"]')?.textContent,
    ).toContain("sess-1");

    act(() => {
      (
        container.querySelector(
          '[data-testid="implementing-overview-resume-session"]',
        ) as HTMLButtonElement
      ).click();
    });

    expect(sendMessageMutate).toHaveBeenCalledWith(
      {
        id: "sess-1",
        body: {
          prompt: "Resume coordination to complete any unfinished tasks.",
        },
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(mutate).not.toHaveBeenCalled();
    expect(selectedTab(container)).toContain("Implementing");
    expect(
      container.querySelector('[data-testid="channel-launch-pending"]'),
    ).toBeNull();
    expect(
      container
        .querySelector('[data-testid="conversation-thread"]')
        ?.getAttribute("data-conversation-id"),
    ).toBe("sess-1");
    expect(useCockpitLaunchStore.getState().pending?.resumeSession?.id).toBe(
      "sess-1",
    );
  });

  it("does not create a session when resume send fails", () => {
    seedEpic();
    mockState.issues = [
      project("p-a"),
      epicRecord("auth-hardening", "p-a", "Auth hardening"),
      storyRecord("story-1", "auth-hardening", "Story one"),
      taskRecord("task-1", "story-1", "todo"),
    ];
    mockState.sessions = [channelSessionListItem({ id: "sess-1" })];
    sendMessageMutate.mockImplementation((_body, options) => {
      options?.onError?.(new ApiError("upstream refused", 500));
    });
    mountDetail("/projects/p-a/issues/auth-hardening");

    act(() => {
      (
        document.querySelector(
          '[data-testid="implementing-overview-resume-session"]',
        ) as HTMLButtonElement
      ).click();
    });

    expect(mutate).not.toHaveBeenCalled();
    expect(useCockpitLaunchStore.getState().fault).toEqual({
      issueId: "auth-hardening",
      kind: "work",
      errorMessage: "upstream refused",
      status: 500,
    });
  });

  it("silently follows a later issues GET that disagrees with the optimistic instrument", () => {
    seedEpic();
    const { container, root } = mountDetail(
      "/projects/p-a/issues/auth-hardening?tab=implementing",
    );
    act(() => {
      (
        container.querySelector(
          '[data-testid="implementing-start-session"]',
        ) as HTMLButtonElement
      ).click();
    });
    act(() => {
      mutateOptions().onSuccess?.({ id: "sess-1" });
    });
    expect(
      container.querySelector('[data-testid="conversation-thread"]'),
    ).toBeTruthy();

    mockState.derived = {
      "auth-hardening": { blocked: false, epicStatus: "todo" },
    };
    remount(root, "/projects/p-a/issues/auth-hardening?tab=implementing");

    expect(
      container.querySelector('[data-testid="conversation-thread"]'),
    ).toBeNull();
    expect(container.textContent).toContain("todo");
    expect(
      container.querySelector('[data-channel-tab-indicator="active-run"]'),
    ).toBeNull();
    expect(container.querySelector('[data-live="false"]')?.textContent).toContain(
      "all quiet",
    );
    expect(container.querySelector('[data-testid="channel-launch-fault"]')).toBeNull();
  });

  it("surfaces a named 409 fault when Overview start hits an implementing lock", () => {
    seedEpic();
    mockState.issues = [
      project("p-a"),
      epicRecord("auth-hardening", "p-a", "Auth hardening"),
      epicRecord("push", "p-a", "Push notifications"),
    ];
    const { container } = mountDetail("/projects/p-a/issues/auth-hardening");

    act(() => {
      (
        container.querySelector(
          '[data-testid="implementing-overview-start-session"]',
        ) as HTMLButtonElement
      ).click();
    });
    act(() => {
      mutateOptions().onError?.(
        new ApiError("conflict", 409, {
          error: "locked",
          holderIssueId: "push",
          holderIssueTitle: "Push notifications",
        }),
      );
    });

    expect(selectedTab(container)).toContain("Implementing");
    expect(
      container.querySelector('[data-testid="channel-launch-fault"]')
        ?.textContent,
    ).toContain(
      "Session create rejected — implementing lock held by Push notifications (409).",
    );
  });

  it("keeps the top bar live on a failed launch when another issue already has a live run", () => {
    seedEpic();
    mockState.issues = [
      project("p-a"),
      epicRecord("auth-hardening", "p-a", "Auth hardening"),
      epicRecord("live-epic", "p-a", "Already flying"),
    ];
    mockState.derived = {
      "auth-hardening": { blocked: false, epicStatus: "todo" },
      "live-epic": { blocked: false, epicStatus: "in-progress", liveRun: true },
    };
    const { container } = mountDetail(
      "/projects/p-a/issues/auth-hardening?tab=implementing",
    );
    act(() => {
      (
        container.querySelector(
          '[data-testid="implementing-start-session"]',
        ) as HTMLButtonElement
      ).click();
    });
    act(() => {
      mutateOptions().onError?.(new ApiError("failed", 500, { error: "nope" }));
    });

    expect(container.querySelector('[data-live="true"]')?.textContent).toContain(
      "agents on the line",
    );
    expect(
      container.querySelector('[data-testid="implementing-start-session"]'),
    ).toBeTruthy();
  });
});

describe("Issue detail launch — project-level Story implementing", () => {
  function seedStory(): void {
    mockState.issue = storyDetail("oauth-hardening", "p-a", "OAuth hardening");
    mockState.issues = [
      project("p-a"),
      storyRecord("oauth-hardening", "p-a", "OAuth hardening"),
      taskRecord("task-1", "oauth-hardening", "todo"),
    ];
    mockState.derived = {
      "oauth-hardening": { blocked: false, storyStatus: "not-started" },
    };
  }

  it("places the post-rail control below the task rail and starts a session", () => {
    seedStory();
    const { container } = mountDetail("/projects/p-a/issues/oauth-hardening");

    expect(
      container.querySelector('[data-testid="story-task-rail"]'),
    ).toBeTruthy();
    expect(workLoopControlIndex(container)).toBeGreaterThan(ownFlowIndex(container));
    expect(
      container.querySelector('[data-testid="implementing-overview-start-session"]')
        ?.textContent,
    ).toContain("Start work loop");

    act(() => {
      (
        container.querySelector(
          '[data-testid="implementing-overview-start-session"]',
        ) as HTMLButtonElement
      ).click();
    });

    expect(mutate).toHaveBeenCalledWith(
      "oauth-hardening",
      "implementing",
      expect.objectContaining({
        title: "Implement OAuth hardening",
        model: "composer-2.5",
      }),
      expect.any(Object),
    );
    expect(selectedTab(container)).toContain("Implementing");
  });

  it("resumes the current session from Overview below the task rail", () => {
    seedStory();
    mockState.sessions = [
      channelSessionListItem({
        id: "sess-oauth",
        title: "Implement OAuth hardening",
        updatedAt: "2026-09-09T10:00:00.000Z",
      }),
    ];
    const { container } = mountDetail("/projects/p-a/issues/oauth-hardening");

    expect(workLoopControlIndex(container)).toBeGreaterThan(ownFlowIndex(container));
    expect(
      container.querySelector('[data-testid="implementing-overview-resume-session"]')
        ?.textContent,
    ).toContain("Resume work loop");
    expect(
      container.querySelector('[data-testid="work-loop-session-ref"]')?.textContent,
    ).toContain("sess-oauth");

    act(() => {
      (
        container.querySelector(
          '[data-testid="implementing-overview-resume-session"]',
        ) as HTMLButtonElement
      ).click();
    });

    expect(sendMessageMutate).toHaveBeenCalledWith(
      {
        id: "sess-oauth",
        body: {
          prompt: "Resume coordination to complete any unfinished tasks.",
        },
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(mutate).not.toHaveBeenCalled();
    expect(selectedTab(container)).toContain("Implementing");
  });
});

describe("Issue detail launch — Idea planning", () => {
  function seedIdea(): void {
    mockState.issue = ideaDetail("offline-sync", "p-a", "Offline sync");
    mockState.issues = [
      project("p-a"),
      ideaRecord("offline-sync", "p-a", "Offline sync"),
    ];
    mockState.derived = {
      "offline-sync": { blocked: false, ideaStatus: "captured" },
    };
  }

  it("flips top bar, planning chip, tab live, run strip, and starting body together on click", () => {
    seedIdea();
    const { container } = mountDetail(
      "/projects/p-a/issues/offline-sync?tab=planning",
    );

    expect(
      container.querySelectorAll('[data-testid="planning-start-session"]').length,
    ).toBe(1);

    act(() => {
      (
        container.querySelector(
          '[data-testid="planning-start-session"]',
        ) as HTMLButtonElement
      ).click();
    });

    expect(container.querySelector('[data-live="true"]')?.textContent).toContain(
      "agents on the line",
    );
    expect(container.textContent).toContain("planning");
    expect(
      container.querySelector('[data-channel-tab-indicator="active-run"]')
        ?.textContent,
    ).toContain("Planning");
    expect(
      container.querySelector('[data-testid="thread-status-strip"]')
        ?.textContent,
    ).toContain("running");
    expect(
      container.querySelector('[data-testid="channel-launch-pending"]')
        ?.textContent,
    ).toContain("Starting the planning session…");
    expect(
      container.querySelector('[data-testid="channel-launch-pending"]')
        ?.textContent,
    ).toContain("The transcript opens here as soon as the session appears.");
  });

  it("shows the session thread on planning ack", () => {
    seedIdea();
    const { container } = mountDetail(
      "/projects/p-a/issues/offline-sync?tab=planning",
    );
    act(() => {
      (
        container.querySelector(
          '[data-testid="planning-start-session"]',
        ) as HTMLButtonElement
      ).click();
    });
    act(() => {
      mutateOptions().onSuccess?.({ id: "plan-1" });
    });

    expect(
      container.querySelector('[data-testid="conversation-thread"]')
        ?.textContent,
    ).toContain("session thread");
    expect(
      container
        .querySelector('[data-testid="conversation-thread"]')
        ?.getAttribute("data-conversation-id"),
    ).toBe("plan-1");
  });

  it("selects Planning immediately when launched from Overview", () => {
    seedIdea();
    const { container } = mountDetail("/projects/p-a/issues/offline-sync");
    expect(selectedTab(container)).toContain("Overview");

    expect(
      container.querySelectorAll(
        '[data-testid="planning-overview-start-session"]',
      ).length,
    ).toBe(1);
    expect(
      container.querySelector('[data-testid="planning-start-session"]'),
    ).toBeNull();

    act(() => {
      (
        container.querySelector(
          '[data-testid="planning-overview-start-session"]',
        ) as HTMLButtonElement
      ).click();
    });

    expect(selectedTab(container)).toContain("Planning");
    expect(
      container.querySelector('[data-testid="channel-launch-pending"]')
        ?.textContent,
    ).toContain("Starting the planning session…");
  });

  it("restores the quiet ready instrument with a named fault", () => {
    seedIdea();
    const { container } = mountDetail(
      "/projects/p-a/issues/offline-sync?tab=planning",
    );
    act(() => {
      (
        container.querySelector(
          '[data-testid="planning-start-session"]',
        ) as HTMLButtonElement
      ).click();
    });
    act(() => {
      mutateOptions().onError?.(new ApiError("upstream refused", 500));
    });

    expect(container.querySelector('[data-live="false"]')?.textContent).toContain(
      "all quiet",
    );
    expect(
      container.querySelector('[data-channel-tab-indicator="active-run"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="channel-launch-pending"]'),
    ).toBeNull();
    expect(
      container.querySelectorAll('[data-testid="planning-start-session"]').length,
    ).toBe(1);
    expect(
      container.querySelector('[data-testid="channel-launch-fault"]')
        ?.textContent,
    ).toContain("Session create rejected — upstream refused.");
  });
});
