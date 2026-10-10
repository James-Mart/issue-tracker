// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DerivedState, IssueRecord } from "@server/schemas";
import type { FlowItem } from "../lib/flow";
import { resetCockpitLaunchStore } from "../store/use-cockpit-launch-store";
import { FlowRowActions } from "./flow-row-actions";

const mutate = vi.fn();
const liveRunConfirm = vi.hoisted(() => ({
  pending: null as null | (() => void | Promise<void>),
}));

vi.mock("@/features/agents/api/queries", () => ({
  useAgentModelsQuery: () => ({
    data: { models: [{ id: "composer-2.5", displayName: "Composer 2.5" }] },
    isLoading: false,
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
    confirmIfLiveRun: (action: () => void | Promise<void>) => {
      liveRunConfirm.pending = action;
    },
    awaitingConfirm: liveRunConfirm.pending !== null,
    confirming: false,
    dialog:
      liveRunConfirm.pending !== null ? (
        <div data-testid="channel-kill-live-run-dialog" />
      ) : null,
  }),
}));

const t0 = "2026-07-01T00:00:00.000Z";

function epic(id: string): Extract<IssueRecord, { kind: "epic" }> {
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

function mountActions(item: FlowItem): {
  container: HTMLDivElement;
  root: Root;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={["/"]}>
        <FlowRowActions item={item} />
      </MemoryRouter>,
    );
  });
  return { container, root };
}

afterEach(() => {
  document.body.innerHTML = "";
  mutate.mockReset();
  liveRunConfirm.pending = null;
  resetCockpitLaunchStore();
});

describe("FlowRowActions start work", () => {
  it("asks before starting when a session is mid-run", () => {
    const item = flowItem(epic("ship-epic"), { blocked: false, epicStatus: "todo" });
    const renderActions = () => (
      <MemoryRouter initialEntries={["/"]}>
        <FlowRowActions item={item} />
      </MemoryRouter>
    );
    const { container, root } = mountActions(item);
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
});
