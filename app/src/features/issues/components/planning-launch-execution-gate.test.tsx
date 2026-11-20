// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IssueRecord } from "@server/schemas";
import { PlanningOverviewLaunch } from "./planning-launch-control";

const mutateAsync = vi.fn();

vi.mock("@/features/agents/api/queries", () => ({
  useAgentModelsQuery: () => ({
    data: { models: [{ id: "composer-2.5", displayName: "Composer 2.5" }] },
    isLoading: false,
  }),
}));

vi.mock("../api/mutations", () => ({
  useCreateChannelSession: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateIssue: () => ({ mutateAsync }),
}));

vi.mock("../api/queries", () => ({
  useIssuesQuery: () => ({ data: { issues: [], derived: {} } }),
  useProjectWorktreesQuery: () => ({
    data: { worktrees: {} },
    isFetched: true,
    isSuccess: true,
    isError: false,
  }),
}));

vi.mock("../hooks/use-issue-patch-action", () => ({
  useIssuePatchAction: () => ({
    error: null,
    saving: false,
    run: async (fn: () => Promise<void>) => {
      await fn();
    },
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

const t0 = "2026-08-10T12:00:00.000Z";

const idea: Extract<IssueRecord, { kind: "idea" }> = {
  kind: "idea",
  id: "capture",
  title: "Capture",
  partOf: "platform",
  order: 0,
  archived: false,
  decompositionGate: false,
  executionGate: "auto",
  outOfBand: false,
  createdAt: t0,
  updatedAt: t0,
};

function mount(ui: React.ReactElement): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  return { container, root };
}

afterEach(() => {
  document.body.innerHTML = "";
  mutateAsync.mockReset();
});

function click(container: HTMLElement, testId: string) {
  return act(async () => {
    (container.querySelector(`[data-testid="${testId}"]`) as HTMLButtonElement).click();
  });
}

describe("Planning plan settings", () => {
  it("saves Auto, On, and Off through the Idea update from overview", async () => {
    mutateAsync.mockResolvedValue({});
    const { container } = mount(<PlanningOverviewLaunch issue={idea} />);

    expect(
      container.querySelector('[data-testid="detail-execution-gate"]')
        ?.getAttribute("data-value"),
    ).toBe("auto");
    expect(container.textContent).toContain("Auto");
    expect(container.textContent).toContain("On");
    expect(container.textContent).toContain("Off");

    await click(container, "detail-execution-gate-auto");
    expect(mutateAsync).not.toHaveBeenCalled();

    await click(container, "detail-execution-gate-on");
    expect(mutateAsync).toHaveBeenCalledWith({
      id: "capture",
      patch: { executionGate: true },
    });

    await click(container, "detail-execution-gate-off");
    expect(mutateAsync).toHaveBeenCalledWith({
      id: "capture",
      patch: { executionGate: false },
    });
  });

  it("hides the other gates when implemented out of band is turned on", async () => {
    mutateAsync.mockResolvedValueOnce({});
    const { container } = mount(<PlanningOverviewLaunch issue={idea} />);

    await click(container, "detail-out-of-band");

    expect(mutateAsync).toHaveBeenCalledWith({
      id: "capture",
      patch: { outOfBand: true },
    });
    expect(
      container.querySelector('[data-testid="detail-decomposition-gate"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="detail-execution-gate"]'),
    ).toBeNull();
  });
});
