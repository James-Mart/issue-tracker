// @vitest-environment happy-dom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChannelSessionListItem } from "@server/schemas";
import { ChannelRetroControl } from "./channel-retro-control";

const sendMutate = vi.fn();
const planningWorkRoot = vi.hoisted(() => ({
  data: undefined as { workRoot: { id: string; title: string; kind: "epic" } | null } | undefined,
  isLoading: false,
  isSuccess: false,
  isError: false,
}));

vi.mock("@/features/agents/api/mutations", () => ({
  useSendConversationMessage: () => ({
    mutate: sendMutate,
    isPending: false,
  }),
}));

vi.mock("../api/queries", () => ({
  usePlanningWorkRootQuery: () => ({
    data: planningWorkRoot.data,
    isLoading: planningWorkRoot.isLoading,
    isSuccess: planningWorkRoot.isSuccess,
    isError: planningWorkRoot.isError,
  }),
}));

const endedSession: ChannelSessionListItem = {
  id: "session-1",
  title: "Plan Capture",
  model: "composer-2.5",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  archived: false,
  activeRun: false,
};

const idea = {
  kind: "idea" as const,
  id: "capture",
  title: "Capture",
  partOf: "platform",
  order: 0,
  archived: false,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

const epic = {
  kind: "epic" as const,
  id: "ship-it",
  title: "Ship it",
  partOf: "platform",
  status: "open" as const,
  order: 0,
  archived: false,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

function mount(
  props: ComponentProps<typeof ChannelRetroControl>,
): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<ChannelRetroControl {...props} />);
  });
  return { container, root };
}

afterEach(() => {
  document.body.innerHTML = "";
  sendMutate.mockReset();
  planningWorkRoot.data = undefined;
  planningWorkRoot.isLoading = false;
  planningWorkRoot.isSuccess = false;
  planningWorkRoot.isError = false;
});

describe("ChannelRetroControl", () => {
  it("does not render while the session is mid-run", () => {
    const { container } = mount({
      channel: "planning",
      session: { ...endedSession, activeRun: true },
      issue: idea,
    });
    expect(container.querySelector('[data-testid="channel-retro"]')).toBeNull();
  });

  it("shows plan-not-landed copy when no work root exists yet", () => {
    planningWorkRoot.data = { workRoot: null };
    planningWorkRoot.isSuccess = true;
    const { container } = mount({
      channel: "planning",
      session: endedSession,
      issue: idea,
    });
    expect(
      container.querySelector('[data-testid="retro-plan-not-landed"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-testid="retro-work-root-fault"]'),
    ).toBeNull();
    expect(
      (
        container.querySelector(
          '[data-testid="channel-retro"]',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("shows a fault hint when the work-root fetch fails", () => {
    planningWorkRoot.isError = true;
    const { container } = mount({
      channel: "planning",
      session: endedSession,
      issue: idea,
    });
    expect(
      container.querySelector('[data-testid="retro-plan-not-landed"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="retro-work-root-fault"]'),
    ).toBeTruthy();
    expect(
      (
        container.querySelector(
          '[data-testid="channel-retro"]',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("sends a retro prompt into the selected session", () => {
    planningWorkRoot.data = {
      workRoot: { id: "ship-it", title: "Ship it", kind: "epic" },
    };
    planningWorkRoot.isSuccess = true;
    const { container } = mount({
      channel: "planning",
      session: endedSession,
      issue: idea,
    });
    act(() => {
      (
        container.querySelector(
          '[data-testid="channel-retro"]',
        ) as HTMLButtonElement
      ).click();
    });
    expect(sendMutate).toHaveBeenCalledWith({
      id: "session-1",
      body: {
        prompt:
          "Run retro on ship-it (Ship it) in the issue tracker using the issue-tracker-retro skill.",
      },
    });
  });

  it("uses the anchored Epic as the work root on implementing", () => {
    const { container } = mount({
      channel: "implementing",
      session: endedSession,
      issue: epic,
    });
    act(() => {
      (
        container.querySelector(
          '[data-testid="channel-retro"]',
        ) as HTMLButtonElement
      ).click();
    });
    expect(sendMutate).toHaveBeenCalledWith({
      id: "session-1",
      body: {
        prompt:
          "Run retro on ship-it (Ship it) in the issue tracker using the issue-tracker-retro skill.",
      },
    });
  });
});
