// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChannelSessionListItem } from "@server/schemas";
import { useConfirmChannelLiveRun } from "./use-confirm-channel-live-run";

const sessionsState = vi.hoisted(() => ({
  data: [] as ChannelSessionListItem[],
}));

const retireChannelLiveSession = vi.hoisted(() => vi.fn());

vi.mock("../api/queries", () => ({
  useChannelSessionsQuery: () => ({
    data: sessionsState.data,
    isLoading: false,
    error: null,
  }),
}));

vi.mock("../lib/retire-channel-live-session", async () => {
  const actual = await vi.importActual<
    typeof import("../lib/retire-channel-live-session")
  >("../lib/retire-channel-live-session");
  return {
    ...actual,
    retireChannelLiveSession,
  };
});

const midRunSession: ChannelSessionListItem = {
  id: "live",
  title: "Plan",
  model: "composer-2.5",
  createdAt: "2026-08-02T00:00:00.000Z",
  updatedAt: "2026-08-02T00:00:00.000Z",
  archived: false,
  activeRun: true,
};

function Probe({
  onReady,
}: {
  onReady: (api: ReturnType<typeof useConfirmChannelLiveRun>) => void;
}) {
  const api = useConfirmChannelLiveRun("capture", "planning");
  onReady(api);
  return (
    <div>
      {api.dialog}
      <span data-testid="confirming">{api.confirming ? "yes" : "no"}</span>
      <span data-testid="awaiting">
        {api.awaitingConfirm ? "yes" : "no"}
      </span>
    </div>
  );
}

function mountProbe(): {
  root: Root;
  getApi: () => ReturnType<typeof useConfirmChannelLiveRun>;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let api!: ReturnType<typeof useConfirmChannelLiveRun>;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <Probe
          onReady={(next) => {
            api = next;
          }}
        />
      </QueryClientProvider>,
    );
  });
  return { root, getApi: () => api };
}

afterEach(() => {
  document.body.innerHTML = "";
  sessionsState.data = [];
  retireChannelLiveSession.mockReset();
});

describe("useConfirmChannelLiveRun", () => {
  it("runs the action immediately when no mid-run session exists", () => {
    sessionsState.data = [
      {
        id: "idle",
        title: "Plan",
        model: "composer-2.5",
        createdAt: "2026-08-02T00:00:00.000Z",
        updatedAt: "2026-08-02T00:00:00.000Z",
        archived: false,
        activeRun: false,
      },
    ];
    const { getApi } = mountProbe();
    const action = vi.fn();
    act(() => {
      getApi().confirmIfLiveRun(action);
    });
    expect(action).toHaveBeenCalledOnce();
    expect(
      document.body.querySelector('[data-testid="channel-kill-live-run-dialog"]'),
    ).toBeNull();
    expect(retireChannelLiveSession).not.toHaveBeenCalled();
  });

  it("asks before retiring a mid-run session and leaves it alone on cancel", async () => {
    sessionsState.data = [midRunSession];
    const { getApi } = mountProbe();
    const action = vi.fn();
    await act(async () => {
      getApi().confirmIfLiveRun(action);
      await Promise.resolve();
    });
    expect(action).not.toHaveBeenCalled();
    expect(getApi().awaitingConfirm).toBe(true);
    expect(
      document.body.querySelector('[data-testid="channel-kill-live-run-dialog"]'),
    ).toBeTruthy();

    act(() => {
      getApi().cancelConfirm();
    });

    expect(action).not.toHaveBeenCalled();
    expect(retireChannelLiveSession).not.toHaveBeenCalled();
    expect(getApi().awaitingConfirm).toBe(false);
    expect(
      document.body.querySelector('[data-testid="channel-kill-live-run-dialog"]'),
    ).toBeNull();
  });

  it("retires then runs the action when confirmed", async () => {
    sessionsState.data = [midRunSession];
    retireChannelLiveSession.mockResolvedValue(undefined);
    const { getApi } = mountProbe();
    const action = vi.fn();
    await act(async () => {
      getApi().confirmIfLiveRun(action);
      await Promise.resolve();
    });

    await act(async () => {
      (
        document.body.querySelector(
          '[data-testid="channel-kill-live-run-confirm"]',
        ) as HTMLButtonElement
      ).click();
    });

    expect(retireChannelLiveSession).toHaveBeenCalledWith("live");
    expect(action).toHaveBeenCalledOnce();
    expect(getApi().awaitingConfirm).toBe(false);
  });

  it("surfaces a retire failure and keeps the dialog open", async () => {
    sessionsState.data = [midRunSession];
    retireChannelLiveSession.mockRejectedValue(new Error("cancel failed"));
    const { getApi } = mountProbe();
    const action = vi.fn();
    await act(async () => {
      getApi().confirmIfLiveRun(action);
      await Promise.resolve();
    });

    await act(async () => {
      (
        document.body.querySelector(
          '[data-testid="channel-kill-live-run-confirm"]',
        ) as HTMLButtonElement
      ).click();
    });

    expect(action).not.toHaveBeenCalled();
    expect(getApi().awaitingConfirm).toBe(true);
    expect(
      document.body.querySelector('[data-testid="channel-kill-live-run-error"]')
        ?.textContent,
    ).toBe("cancel failed");
  });
});
