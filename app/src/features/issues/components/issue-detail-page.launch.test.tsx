// @vitest-environment happy-dom
import { act } from "react";
import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { channelSessionListItem } from "../test/channel-session-list-item";
import { useCockpitLaunchStore } from "../store/use-cockpit-launch-store";
import {
  epicDetail,
  epicRecord,
  mockState,
  mountDetail,
  mutate,
  mutateOptions,
  project,
  sendMessageMutate,
  storyRecord,
  taskRecord,
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
});
