// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { skillPath } from "@/lib/plugin-paths";
import { resetAppendTargetDraftStore } from "../store/use-append-target-draft-store";
import { resetCockpitLaunchStore } from "../store/use-cockpit-launch-store";
import { PlanningChannelEmptyState } from "./planning-launch-control";

const mutate = vi.fn();

vi.mock("@/features/agents/api/queries", () => ({
  useAgentModelsQuery: () => ({
    data: {
      models: [
        { id: "composer-2.5", displayName: "Composer 2.5" },
        { id: "claude-opus-5", displayName: "Opus 5" },
      ],
    },
    isLoading: false,
  }),
}));

vi.mock("../api/mutations", () => ({
  useCreateChannelSession: () => ({
    mutate,
    isPending: false,
  }),
  useUpdateIssue: () => ({ mutateAsync: vi.fn() }),
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
    confirmIfLiveRun: (action: () => void | Promise<void>) => {
      void action();
    },
    cancelConfirm: vi.fn(),
    awaitingConfirm: false,
    confirming: false,
    dialog: null,
  }),
}));

vi.mock("./stakeholder-select", () => ({
  StakeholderSelect: () => null,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    disabled,
    children,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    disabled?: boolean;
    children: React.ReactNode;
  }) => (
    <select
      data-testid="planning-session-model"
      value={value}
      disabled={disabled}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({
    value,
    children,
  }: {
    value: string;
    children: React.ReactNode;
  }) => <option value={value}>{children}</option>,
}));

const t0 = "2026-08-10T12:00:00.000Z";

const idea = {
  kind: "idea" as const,
  id: "capture",
  title: "Capture",
  partOf: "platform",
  order: 0,
  archived: false,
  createdAt: t0,
  updatedAt: t0,
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
    root.render(ui);
  });
  return { container, root };
}

afterEach(() => {
  document.body.innerHTML = "";
  mutate.mockReset();
  resetCockpitLaunchStore();
  resetAppendTargetDraftStore();
});

describe("PlanningChannelEmptyState", () => {
  it("shows manual grill copy and posts issue-tracker-plan when stakeholder is unset", () => {
    const onStarted = vi.fn();
    const { container } = mount(
      <PlanningChannelEmptyState
        issue={idea}
        channel="planning"
        onStarted={onStarted}
      />,
    );
    expect(container.textContent).toContain("Start planning grill");
    expect(container.textContent).toContain("you answer");

    const modelSelect = container.querySelector(
      '[data-testid="planning-session-model"]',
    ) as HTMLSelectElement;
    expect(modelSelect).toBeTruthy();
    expect(modelSelect.value).toBe("composer-2.5");

    act(() => {
      (
        container.querySelector(
          '[data-testid="planning-start-session"]',
        ) as HTMLButtonElement
      ).click();
    });

    expect(mutate).toHaveBeenCalledWith(
      {
        title: "Plan Capture",
        model: "composer-2.5",
        message:
          `Plan capture in the issue tracker using the issue-tracker-plan skill. Read ${skillPath("issue-tracker-plan")} and follow it.`,
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("shows auto-plan copy and posts issue-tracker-auto-plan when a slug is set", () => {
    const ideaWithStakeholder = { ...idea, stakeholder: "claude-opus-5" };
    const { container } = mount(
      <PlanningChannelEmptyState
        issue={ideaWithStakeholder}
        channel="planning"
        onStarted={vi.fn()}
      />,
    );
    expect(container.textContent).toContain("Start auto-plan on Opus 5");
    expect(container.textContent).toContain("gate rubric");
    expect(
      container.querySelector('[data-testid="planning-session-model"]'),
    ).toBeNull();

    act(() => {
      (
        container.querySelector(
          '[data-testid="planning-start-session"]',
        ) as HTMLButtonElement
      ).click();
    });

    expect(mutate).toHaveBeenCalledWith(
      {
        title: "Plan Capture",
        model: "claude-opus-5",
        message:
          `Plan capture in the issue tracker using the issue-tracker-auto-plan skill. Read ${skillPath("issue-tracker-auto-plan")} and follow it. Stakeholder model: claude-opus-5.`,
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });
});
