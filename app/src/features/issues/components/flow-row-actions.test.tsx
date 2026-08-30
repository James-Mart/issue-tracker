// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/errors";
import type { DerivedState, IssueRecord } from "@server/schemas";
import type { FlowItem } from "../lib/flow";
import { skillPath } from "@/lib/plugin-paths";
import { resetCockpitLaunchStore } from "../store/use-cockpit-launch-store";
import { FlowRowActions } from "./flow-row-actions";

const mutate = vi.fn();
const modelsState = vi.hoisted(() => ({
  models: [{ id: "composer-2.5", displayName: "Composer 2.5" }],
  isLoading: false,
}));
const liveRunConfirm = vi.hoisted(() => ({
  midRun: false,
  pending: null as null | (() => void | Promise<void>),
  confirming: false,
}));

vi.mock("@/features/agents/api/queries", () => ({
  useAgentModelsQuery: () => ({
    data: { models: modelsState.models },
    isLoading: modelsState.isLoading,
  }),
}));

vi.mock("../api/mutations", () => ({
  useCreateChannelSession: (issueId: string, channel: string) => ({
    mutate: (...args: unknown[]) => {
      mutate(issueId, channel, ...args);
    },
    isPending: false,
  }),
  useUpdateIssue: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock("../hooks/use-confirm-channel-live-run", () => ({
  useConfirmChannelLiveRun: () => ({
    confirmIfLiveRun: (action: () => void) => {
      if (!liveRunConfirm.midRun) {
        action();
        return;
      }
      liveRunConfirm.pending = action;
    },
    awaitingConfirm: liveRunConfirm.pending !== null,
    confirming: liveRunConfirm.confirming,
    dialog:
      liveRunConfirm.pending !== null ? (
        <div data-testid="channel-kill-live-run-dialog">
          <button
            type="button"
            data-testid="channel-kill-live-run-confirm"
            onClick={() => {
              const action = liveRunConfirm.pending;
              liveRunConfirm.pending = null;
              void action?.();
            }}
          >
            Kill and archive
          </button>
        </div>
      ) : null,
  }),
}));

const t0 = "2026-07-01T00:00:00.000Z";

function idea(id: string, stakeholder?: string): IssueRecord {
  return {
    id,
    kind: "idea",
    title: `Idea ${id}`,
    partOf: "project-a",
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    archived: false,
    stakeholder,
  };
}

function story(id: string, prUrl?: string): IssueRecord {
  return {
    id,
    kind: "story",
    title: id,
    partOf: "project-a",
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    branchName: id,
    merged: false,
    needsAttention: false,
    attentionReason: null,
    archived: false,
    prUrl,
  };
}

function epic(id: string): IssueRecord {
  return {
    id,
    kind: "epic",
    title: id,
    partOf: "project-a",
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    needsAttention: false,
    attentionReason: null,
    blockedBy: [],
    archived: false,
  };
}

function flowItem(
  issue: IssueRecord,
  state?: DerivedState,
): FlowItem {
  return { issue, state };
}

function mountActions(
  item: FlowItem,
  onImplementingLockRefusal?: (refusal: {
    holderIssueId: string;
    holderIssueTitle: string;
  }) => void,
): {
  container: HTMLDivElement;
  root: Root;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={["/"]}>
        <FlowRowActions
          item={item}
          onImplementingLockRefusal={onImplementingLockRefusal}
        />
      </MemoryRouter>,
    );
  });
  return { container, root };
}

function buttonCount(container: HTMLElement): number {
  return container.querySelectorAll("button").length;
}

afterEach(() => {
  document.body.innerHTML = "";
  mutate.mockReset();
  modelsState.isLoading = false;
  liveRunConfirm.midRun = false;
  liveRunConfirm.pending = null;
  liveRunConfirm.confirming = false;
  resetCockpitLaunchStore();
});

describe("FlowRowActions start planning", () => {
  it("shows begin planning only on captured Idea rows", () => {
    const captured = mountActions(
      flowItem(idea("capture-me"), { blocked: false, ideaStatus: "captured" }),
    );
    const startButton = captured.container.querySelector(
      '[data-testid="flow-row-start-planning"]',
    );
    expect(startButton).toBeTruthy();
    expect(startButton?.getAttribute("aria-label")).toBe("Begin planning");
    expect(startButton?.getAttribute("title")).toBe("Begin planning");
    expect(startButton?.closest("button")?.hasAttribute("disabled")).toBe(false);

    const planning = mountActions(
      flowItem(idea("planning"), { blocked: false, ideaStatus: "planning" }),
    );
    expect(
      planning.container.querySelector('[data-testid="flow-row-start-planning"]'),
    ).toBeNull();

    const storyRow = mountActions(
      flowItem(story("ship"), { blocked: false, storyStatus: "in-progress" }),
    );
    expect(
      storyRow.container.querySelector('[data-testid="flow-row-start-planning"]'),
    ).toBeNull();
  });

  it("posts to the planning channel sessions endpoint for that Idea", () => {
    const { container } = mountActions(
      flowItem(idea("capture-me"), { blocked: false, ideaStatus: "captured" }),
    );

    act(() => {
      (
        container.querySelector(
          '[data-testid="flow-row-start-planning"]',
        ) as HTMLButtonElement
      ).click();
    });

    expect(mutate).toHaveBeenCalledWith(
      "capture-me",
      "planning",
      {
        title: "Plan Idea capture-me",
        model: "composer-2.5",
        message:
          `Plan capture-me in the issue tracker using the issue-tracker-plan skill. Read ${skillPath("issue-tracker-plan")} and follow it.`,
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("renders nothing while planner models are loading", () => {
    modelsState.isLoading = true;
    const { container } = mountActions(
      flowItem(idea("capture-me"), { blocked: false, ideaStatus: "captured" }),
    );
    expect(buttonCount(container)).toBe(0);
  });
});

describe("FlowRowActions start work", () => {
  it("shows start work only on ready Epic and not-started Story rows", () => {
    const readyEpic = mountActions(
      flowItem(epic("ship-epic"), { blocked: false, epicStatus: "todo" }),
      vi.fn(),
    );
    const startEpic = readyEpic.container.querySelector(
      '[data-testid="flow-row-start-work"]',
    );
    expect(startEpic).toBeTruthy();
    expect(startEpic?.getAttribute("aria-label")).toBe("Start work");
    expect(startEpic?.getAttribute("title")).toBe("Start work");

    const readyStory = mountActions(
      flowItem(story("ship-story"), {
        blocked: false,
        storyStatus: "not-started",
      }),
      vi.fn(),
    );
    expect(
      readyStory.container.querySelector('[data-testid="flow-row-start-work"]'),
    ).toBeTruthy();

    const inFlight = mountActions(
      flowItem(epic("flight"), { blocked: false, epicStatus: "in-progress" }),
      vi.fn(),
    );
    expect(
      inFlight.container.querySelector('[data-testid="flow-row-start-work"]'),
    ).toBeNull();

    const attention = mountActions(
      flowItem({ ...epic("flagged"), needsAttention: true }, {
        blocked: false,
        epicStatus: "todo",
      }),
      vi.fn(),
    );
    expect(
      attention.container.querySelector('[data-testid="flow-row-start-work"]'),
    ).toBeNull();
  });

  it("posts to the implementing channel sessions endpoint for that work root", () => {
    const { container } = mountActions(
      flowItem(epic("ship-epic"), { blocked: false, epicStatus: "todo" }),
      vi.fn(),
    );

    act(() => {
      (
        container.querySelector(
          '[data-testid="flow-row-start-work"]',
        ) as HTMLButtonElement
      ).click();
    });

    expect(mutate).toHaveBeenCalledWith(
      "ship-epic",
      "implementing",
      {
        title: "Implement ship-epic",
        model: "composer-2.5",
        message:
          `Work ship-epic in the issue tracker using the issue-tracker-work skill. Read ${skillPath("issue-tracker-work")} and follow it.`,
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("asks before starting when a session is mid-run", () => {
    liveRunConfirm.midRun = true;
    const item = flowItem(epic("ship-epic"), { blocked: false, epicStatus: "todo" });
    const renderActions = () => (
      <MemoryRouter initialEntries={["/"]}>
        <FlowRowActions item={item} onImplementingLockRefusal={vi.fn()} />
      </MemoryRouter>
    );
    const { container, root } = mountActions(item, vi.fn());
    act(() => {
      root.render(renderActions());
    });

    act(() => {
      (
        container.querySelector(
          '[data-testid="flow-row-start-work"]',
        ) as HTMLButtonElement
      ).click();
    });
    act(() => {
      root.render(renderActions());
    });

    expect(mutate).not.toHaveBeenCalled();
    expect(
      container.querySelector('[data-testid="channel-kill-live-run-dialog"]'),
    ).toBeTruthy();
  });

  it("surfaces a project lock refusal via onImplementingLockRefusal", () => {
    mutate.mockImplementation((_issueId, _channel, _body, options) => {
      options?.onError?.(
        new ApiError("conflict", 409, {
          error: "locked",
          holderIssueId: "other-epic",
          holderIssueTitle: "Other epic",
        }),
      );
    });
    const onLockRefusal = vi.fn();
    const { container } = mountActions(
      flowItem(epic("ship-epic"), { blocked: false, epicStatus: "todo" }),
      onLockRefusal,
    );

    act(() => {
      (
        container.querySelector(
          '[data-testid="flow-row-start-work"]',
        ) as HTMLButtonElement
      ).click();
    });

    expect(onLockRefusal).toHaveBeenCalledWith({
      holderIssueId: "other-epic",
      holderIssueTitle: "Other epic",
    });
  });

  it("renders nothing while coordinator models are loading", () => {
    modelsState.isLoading = true;
    const { container } = mountActions(
      flowItem(epic("ship-epic"), { blocked: false, epicStatus: "todo" }),
      vi.fn(),
    );
    expect(buttonCount(container)).toBe(0);
  });
});

describe("FlowRowActions open PR", () => {
  it("shows icon-only Open PR only when the Story has a prUrl", () => {
    const withPr = mountActions(
      flowItem(story("ship", "https://github.com/org/repo/pull/1"), {
        blocked: false,
        storyStatus: "in-progress",
      }),
    );
    const link = withPr.container.querySelector(
      'a[href="https://github.com/org/repo/pull/1"]',
    );
    expect(link).toBeTruthy();
    expect(link?.getAttribute("aria-label")).toBe("Open PR");
    expect(link?.getAttribute("title")).toBe("Open PR");
    expect(link?.textContent?.trim()).toBe("");
    expect(withPr.container.querySelector('[data-testid="pr-chip"]')).toBeNull();

    const withoutPr = mountActions(
      flowItem(story("no-pr"), { blocked: false, storyStatus: "in-progress" }),
    );
    expect(withoutPr.container.querySelector('a[href^="http"]')).toBeNull();
  });
});

describe("FlowRowActions quiet buckets", () => {
  it("renders no controls for needs-attention, in-flight, or recently merged rows", () => {
    for (const item of [
      flowItem({ ...story("attention"), needsAttention: true }, {
        blocked: false,
        storyStatus: "not-started",
      }),
      flowItem(story("flight"), { blocked: false, storyStatus: "in-progress" }),
      flowItem({ ...story("merged"), merged: true }, {
        blocked: false,
        storyStatus: "merged",
      }),
    ]) {
      const { container } = mountActions(item, vi.fn());
      expect(buttonCount(container)).toBe(0);
    }
  });
});
