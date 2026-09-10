// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { skillPath } from "@/lib/plugin-paths";
import { resetCockpitLaunchStore } from "../store/use-cockpit-launch-store";
import {
  ImplementingChannelEmptyState,
  ImplementingNewRunControl,
} from "./implementing-launch-control";

const mutate = vi.fn();

const modelsState = vi.hoisted(() => ({
  models: [
    { id: "composer-2.5", displayName: "Composer 2.5" },
    { id: "claude-opus-5", displayName: "Opus 5" },
  ],
  isLoading: false,
}));

vi.mock("@/features/agents/api/queries", () => ({
  useAgentModelsQuery: () => ({
    data: { models: modelsState.models },
    isLoading: modelsState.isLoading,
  }),
}));

vi.mock("../api/mutations", () => ({
  useCreateChannelSession: () => ({
    mutate,
    isPending: false,
  }),
}));

const liveRunConfirm = vi.hoisted(() => ({
  midRun: false,
  pending: null as null | (() => void | Promise<void>),
  confirming: false,
}));

vi.mock("../hooks/use-confirm-channel-live-run", () => ({
  useConfirmChannelLiveRun: () => ({
    confirmIfLiveRun: (action: () => void | Promise<void>) => {
      if (!liveRunConfirm.midRun) {
        void action();
        return;
      }
      liveRunConfirm.pending = action;
    },
    cancelConfirm: () => {
      liveRunConfirm.pending = null;
    },
    awaitingConfirm: liveRunConfirm.pending !== null,
    confirming: liveRunConfirm.confirming,
    dialog:
      liveRunConfirm.pending !== null ? (
        <div data-testid="channel-kill-live-run-dialog">
          <button
            type="button"
            onClick={() => {
              liveRunConfirm.pending = null;
            }}
          >
            Cancel
          </button>
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

const epic = {
  kind: "epic" as const,
  id: "ship-it",
  title: "Ship it",
  partOf: "platform",
  status: "open" as const,
  order: 0,
  archived: false,
  createdAt: "2026-08-10T12:00:00.000Z",
  updatedAt: "2026-08-10T12:00:00.000Z",
};

function mount(
  ui: React.ReactElement,
): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<MemoryRouter>{ui}</MemoryRouter>);
  });
  return { container, root };
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

describe("ImplementingChannelEmptyState", () => {
  it("shows work-loop copy and posts issue-tracker-work on start", () => {
    const onStarted = vi.fn();
    const { container } = mount(
      <ImplementingChannelEmptyState
        issue={epic}
        channel="implementing"
        onStarted={onStarted}
      />,
    );
    expect(container.textContent).toContain("Start work loop");
    expect(container.textContent).toContain("coordinator");

    act(() => {
      (
        container.querySelector(
          '[data-testid="implementing-start-session"]',
        ) as HTMLButtonElement
      ).click();
    });

    expect(mutate).toHaveBeenCalledWith(
      {
        title: "Implement Ship it",
        model: "composer-2.5",
        message:
          `Work ship-it in the issue tracker using the issue-tracker-work skill. Read ${skillPath("issue-tracker-work")} and follow it.`,
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

});

describe("ImplementingNewRunControl", () => {
  it("renders a secondary New run action", () => {
    const { container } = mount(
      <ImplementingNewRunControl
        issue={epic}
        channel="implementing"
        onStarted={vi.fn()}
      />,
    );
    const button = container.querySelector(
      '[data-testid="implementing-new-run"]',
    );
    expect(button?.textContent).toBe("New run");
  });

  it("asks before starting a new run when a session is mid-run", () => {
    liveRunConfirm.midRun = true;
    const renderControl = () => (
      <ImplementingNewRunControl
        issue={epic}
        channel="implementing"
        onStarted={vi.fn()}
      />
    );
    const { container, root } = mount(renderControl());

    act(() => {
      (
        container.querySelector(
          '[data-testid="implementing-new-run"]',
        ) as HTMLButtonElement
      ).click();
    });
    act(() => {
      root.render(<MemoryRouter>{renderControl()}</MemoryRouter>);
    });

    expect(mutate).not.toHaveBeenCalled();
    expect(
      container.querySelector('[data-testid="channel-kill-live-run-dialog"]'),
    ).toBeTruthy();
  });
});
