// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IssueRecord } from "@server/schemas";
import {
  PlanningFlowRowLaunch,
  PlanningOverviewLaunch,
} from "./planning-launch-control";

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

describe("Planning execution gate chip", () => {
  it("hides execution gate chips when no stakeholder is set", () => {
    const flow = mount(<PlanningFlowRowLaunch issue={idea} />);
    expect(
      flow.container.querySelector('[data-testid="flow-row-execution-gate"]'),
    ).toBeNull();

    const overview = mount(<PlanningOverviewLaunch issue={idea} />);
    expect(
      overview.container.querySelector('[data-testid="detail-execution-gate"]'),
    ).toBeNull();
  });

  it("shows the execution gate chip beside the outline gate when a stakeholder is set", () => {
    const ideaWithStakeholder = {
      ...idea,
      id: "exec-gate",
      stakeholder: "claude-opus-5",
      executionGate: true as const,
    };
    const { container } = mount(
      <PlanningFlowRowLaunch issue={ideaWithStakeholder} />,
    );
    const chip = container.querySelector(
      '[data-testid="flow-row-execution-gate"]',
    ) as HTMLButtonElement;
    expect(chip).toBeTruthy();
    expect(chip.textContent).toContain("Execution gate ·");
    expect(chip.textContent).toContain("on");
    expect(chip.id).toBe("execution-gate-exec-gate");
  });

  it("toggles executionGate through the Idea update endpoint from the flow row", async () => {
    mutateAsync.mockResolvedValueOnce({});
    const ideaWithStakeholder = {
      ...idea,
      id: "exec-toggle",
      stakeholder: "claude-opus-5",
    };
    const { container } = mount(
      <PlanningFlowRowLaunch issue={ideaWithStakeholder} />,
    );

    await act(async () => {
      (
        container.querySelector(
          '[data-testid="flow-row-execution-gate"]',
        ) as HTMLButtonElement
      ).click();
    });

    expect(mutateAsync).toHaveBeenCalledWith({
      id: "exec-toggle",
      patch: { executionGate: true },
    });
  });

  it("toggles executionGate through the Idea update endpoint from overview", async () => {
    mutateAsync.mockResolvedValueOnce({});
    const ideaWithStakeholder = {
      ...idea,
      id: "overview-exec-toggle",
      stakeholder: "claude-opus-5",
    };
    const { container } = mount(
      <PlanningOverviewLaunch issue={ideaWithStakeholder} />,
    );

    await act(async () => {
      (
        container.querySelector(
          '[data-testid="detail-execution-gate"]',
        ) as HTMLButtonElement
      ).click();
    });

    expect(mutateAsync).toHaveBeenCalledWith({
      id: "overview-exec-toggle",
      patch: { executionGate: true },
    });
  });
});
