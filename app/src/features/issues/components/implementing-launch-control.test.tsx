// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImplementingWorkRoot } from "@server/services/implementing-launch";
import { resetCockpitLaunchStore } from "../store/use-cockpit-launch-store";
import { ImplementingNewRunControl } from "./implementing-launch-control";

const mutate = vi.fn();

vi.mock("@/features/agents/api/queries", () => ({
  useAgentModelsQuery: () => ({
    data: { models: [{ id: "composer-2.5", displayName: "Composer 2.5" }] },
    isLoading: false,
  }),
}));

vi.mock("../api/mutations", () => ({
  useCreateChannelSession: () => ({
    mutate,
    isPending: false,
  }),
}));

const liveRunConfirm = vi.hoisted(() => ({
  pending: null as null | (() => void | Promise<void>),
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

const epic: ImplementingWorkRoot = {
  kind: "epic",
  id: "ship-it",
  title: "Ship it",
  partOf: "platform",
  blockedBy: [],
  order: 0,
  archived: false,
  needsAttention: false,
  attentionReason: null,
  createdAt: "2026-08-10T12:00:00.000Z",
  updatedAt: "2026-08-10T12:00:00.000Z",
  description: "",
  version: "1",
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
  liveRunConfirm.pending = null;
  resetCockpitLaunchStore();
});

describe("ImplementingNewRunControl", () => {
  it("asks before starting a new run when a session is mid-run", () => {
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
