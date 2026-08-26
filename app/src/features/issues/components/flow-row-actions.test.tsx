// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DerivedState, IssueRecord } from "@server/schemas";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { FlowItem } from "../lib/flow";
import { skillPath } from "@/lib/plugin-paths";
import { FlowRowActions, FlowRowTouchMenu } from "./flow-row-actions";

const mutate = vi.fn();
const deletePartialPlanMutate = vi.fn();
const modelsState = vi.hoisted(() => ({
  models: [{ id: "composer-2.5", displayName: "Composer 2.5" }],
  isLoading: false,
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
  useDeletePartialPlan: () => ({
    mutate: deletePartialPlanMutate,
    isPending: false,
  }),
  useUpdateIssue: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock("../api/queries", () => ({
  useProjectPullRequestsQuery: () => ({
    data: undefined,
  }),
}));

vi.mock("../hooks/use-confirm-channel-live-run", () => ({
  useConfirmChannelLiveRun: () => ({
    confirmIfLiveRun: (action: () => void) => {
      action();
    },
    awaitingConfirm: false,
    confirming: false,
    dialog: null,
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

function story(id: string): IssueRecord {
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
  };
}

function flowItem(
  issue: IssueRecord,
  state?: DerivedState,
): FlowItem {
  return { issue, state };
}

function mountActions(item: FlowItem): {
  container: HTMLDivElement;
  root: Root;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={["/projects/project-a"]}>
        <FlowRowActions item={item} task={undefined} />
      </MemoryRouter>,
    );
  });
  return { container, root };
}

function mountTouchMenu(item: FlowItem): {
  container: HTMLDivElement;
  root: Root;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={["/projects/project-a"]}>
        <DropdownMenu open>
          <DropdownMenuTrigger asChild>
            <button type="button">Menu</button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <FlowRowTouchMenu item={item} task={undefined} />
          </DropdownMenuContent>
        </DropdownMenu>
      </MemoryRouter>,
    );
  });
  return { container, root };
}

afterEach(() => {
  document.body.innerHTML = "";
  mutate.mockReset();
  deletePartialPlanMutate.mockReset();
  modelsState.isLoading = false;
});

describe("FlowRowActions start planning", () => {
  it("shows start planning only on captured Idea rows", () => {
    const captured = mountActions(
      flowItem(idea("capture-me"), { blocked: false, ideaStatus: "captured" }),
    );
    expect(
      captured.container.querySelector('[data-testid="flow-row-start-planning"]'),
    ).toBeTruthy();

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
});

describe("FlowRowActions delete partial plan", () => {
  it("shows delete partial plan only on awaiting-direction Idea rows", () => {
    const awaiting = mountActions(
      flowItem(idea("stalled"), {
        blocked: false,
        ideaStatus: "awaiting-direction",
      }),
    );
    expect(
      awaiting.container.querySelector(
        '[data-testid="flow-row-delete-partial-plan"]',
      ),
    ).toBeTruthy();

    const captured = mountActions(
      flowItem(idea("fresh"), { blocked: false, ideaStatus: "captured" }),
    );
    expect(
      captured.container.querySelector(
        '[data-testid="flow-row-delete-partial-plan"]',
      ),
    ).toBeNull();

    const planning = mountActions(
      flowItem(idea("in-flight"), { blocked: false, ideaStatus: "planning" }),
    );
    expect(
      planning.container.querySelector(
        '[data-testid="flow-row-delete-partial-plan"]',
      ),
    ).toBeNull();
  });

  it("confirms before deleting the partial plan", () => {
    const { container } = mountActions(
      flowItem(idea("stalled"), {
        blocked: false,
        ideaStatus: "awaiting-direction",
      }),
    );

    act(() => {
      (
        container.querySelector(
          '[data-testid="flow-row-delete-partial-plan"]',
        ) as HTMLButtonElement
      ).click();
    });

    expect(
      document.body.querySelector('[data-testid="delete-partial-plan-dialog"]'),
    ).toBeTruthy();

    deletePartialPlanMutate.mockImplementation((_input, options) => {
      options?.onSuccess?.();
    });

    act(() => {
      const deleteButton = document.body.querySelector(
        '[data-testid="delete-partial-plan-dialog"] button:last-of-type',
      ) as HTMLButtonElement;
      deleteButton.click();
    });

    expect(deletePartialPlanMutate).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });
});

describe("FlowRowTouchMenu delete partial plan", () => {
  it("shows delete partial plan only on awaiting-direction Idea rows", () => {
    mountTouchMenu(
      flowItem(idea("stalled"), {
        blocked: false,
        ideaStatus: "awaiting-direction",
      }),
    );
    expect(
      document.body.querySelector(
        '[data-testid="flow-row-delete-partial-plan-menu"]',
      ),
    ).toBeTruthy();

    document.body.innerHTML = "";

    mountTouchMenu(
      flowItem(idea("fresh"), { blocked: false, ideaStatus: "captured" }),
    );
    expect(
      document.body.querySelector(
        '[data-testid="flow-row-delete-partial-plan-menu"]',
      ),
    ).toBeNull();
  });
});
