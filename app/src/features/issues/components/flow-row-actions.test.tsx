// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DerivedState, IssueRecord } from "@server/schemas";
import type { FlowItem } from "../lib/flow";
import { FlowRowActions } from "./flow-row-actions";

const mutate = vi.fn();
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

afterEach(() => {
  document.body.innerHTML = "";
  mutate.mockReset();
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
          "Plan capture-me in the issue tracker using the issue-tracker-plan skill.",
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });
});
