// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { skillPath } from "@/lib/plugin-paths";
import { MANUAL_STAKEHOLDER_LABEL } from "@server/fields";
import { resetCockpitLaunchStore } from "../store/use-cockpit-launch-store";
import {
  PlanningChannelEmptyState,
  PlanningFlowRowLaunch,
  PlanningNewRunControl,
  PlanningOverviewLaunch,
} from "./planning-launch-control";

const mutate = vi.fn();
const mutateAsync = vi.fn();
const modelsState = vi.hoisted(() => ({
  models: [
    { id: "composer-2.5", displayName: "Composer 2.5" },
    { id: "claude-opus-5", displayName: "Opus 5" },
  ],
  isLoading: false,
}));
const issueState = vi.hoisted(() => ({
  stakeholder: undefined as string | undefined,
}));
const patchActionState = vi.hoisted(() => ({
  error: null as string | null,
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
  useUpdateIssue: () => ({
    mutateAsync,
  }),
}));

vi.mock("../hooks/use-issue-patch-action", () => ({
  useIssuePatchAction: () => ({
    error: patchActionState.error,
    saving: false,
    run: async (fn: () => Promise<void>) => {
      try {
        await fn();
      } catch (err) {
        patchActionState.error =
          err instanceof Error ? err.message : "Request failed";
      }
    },
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

vi.mock("./stakeholder-select", () => ({
  StakeholderSelect: ({
    value,
    onChange,
  }: {
    value: string | undefined;
    onChange: (value: string | null) => void;
  }) => (
    <select
      data-testid="stakeholder-select"
      value={value ?? "__manual__"}
      onChange={(event) =>
        onChange(
          event.target.value === "__manual__" ? null : event.target.value,
        )
      }
    >
      <option value="__manual__">{MANUAL_STAKEHOLDER_LABEL}</option>
      <option value="claude-opus-5">Opus 5</option>
    </select>
  ),
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

const idea = {
  kind: "idea" as const,
  id: "capture",
  title: "Capture",
  partOf: "platform",
  order: 0,
  archived: false,
  createdAt: "2026-08-10T12:00:00.000Z",
  updatedAt: "2026-08-10T12:00:00.000Z",
  stakeholder: issueState.stakeholder,
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
  mutateAsync.mockReset();
  issueState.stakeholder = undefined;
  modelsState.isLoading = false;
  patchActionState.error = null;
  liveRunConfirm.midRun = false;
  liveRunConfirm.pending = null;
  liveRunConfirm.confirming = false;
  resetCockpitLaunchStore();
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

  it("uses the selected planner model when stakeholder is unset", () => {
    const { container } = mount(
      <PlanningChannelEmptyState
        issue={idea}
        channel="planning"
        onStarted={vi.fn()}
      />,
    );
    const modelSelect = container.querySelector(
      '[data-testid="planning-session-model"]',
    ) as HTMLSelectElement;

    act(() => {
      modelSelect.value = "claude-opus-5";
      modelSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

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
          `Plan capture in the issue tracker using the issue-tracker-plan skill. Read ${skillPath("issue-tracker-plan")} and follow it.`,
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("shows auto-plan copy and posts issue-tracker-auto-plan when a slug is set", () => {
    issueState.stakeholder = "claude-opus-5";
    const ideaWithStakeholder = { ...idea, stakeholder: "claude-opus-5" };
    const { container } = mount(
      <PlanningChannelEmptyState
        issue={ideaWithStakeholder}
        channel="planning"
        onStarted={vi.fn()}
      />,
    );
    expect(container.textContent).toContain("Start auto-plan on Opus 5");
    expect(container.textContent).toContain("without your answers");
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

  it("updates launch copy when the picker selects a slug", () => {
    const { container } = mount(
      <PlanningChannelEmptyState
        issue={idea}
        channel="planning"
        onStarted={vi.fn()}
      />,
    );
    const select = container.querySelector(
      "[data-testid=stakeholder-select]",
    ) as HTMLSelectElement;
    act(() => {
      select.value = "claude-opus-5";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.textContent).toContain("Start auto-plan on Opus 5");
  });

  it("reverts the picker when the stakeholder patch fails", async () => {
    mutateAsync.mockRejectedValueOnce(new Error("patch failed"));
    const { container } = mount(
      <PlanningChannelEmptyState
        issue={idea}
        channel="planning"
        onStarted={vi.fn()}
      />,
    );
    const select = () =>
      container.querySelector(
        "[data-testid=stakeholder-select]",
      ) as HTMLSelectElement;

    await act(async () => {
      select().value = "claude-opus-5";
      select().dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(select().value).toBe("__manual__");
    expect(container.textContent).toContain("Start planning grill");
  });

  it("hides the approve plan chip when no stakeholder is set", () => {
    const { container } = mount(
      <PlanningChannelEmptyState
        issue={idea}
        channel="planning"
        onStarted={vi.fn()}
      />,
    );
    expect(
      container.querySelector('[data-testid="detail-approve-plan"]'),
    ).toBeNull();
  });

  it("shows the approve plan chip in both states when a stakeholder is set", () => {
    const ideaOff = {
      ...idea,
      stakeholder: "claude-opus-5",
    };
    const { container: offContainer } = mount(
      <PlanningChannelEmptyState
        issue={ideaOff}
        channel="planning"
        onStarted={vi.fn()}
      />,
    );
    const offChip = offContainer.querySelector(
      '[data-testid="detail-approve-plan"]',
    ) as HTMLButtonElement;
    expect(offChip).toBeTruthy();
    expect(offChip.textContent).toContain("off");
    expect(offChip.getAttribute("aria-pressed")).toBe("false");

    const ideaOn = {
      ...idea,
      stakeholder: "claude-opus-5",
      approvePlan: true as const,
    };
    const { container: onContainer } = mount(
      <PlanningChannelEmptyState
        issue={ideaOn}
        channel="planning"
        onStarted={vi.fn()}
      />,
    );
    const onChip = onContainer.querySelector(
      '[data-testid="detail-approve-plan"]',
    ) as HTMLButtonElement;
    expect(onChip.textContent).toContain("on");
    expect(onChip.getAttribute("aria-pressed")).toBe("true");
  });

  it("uses gate copy when approve plan is on and auto-plan copy when off", () => {
    const ideaOff = {
      ...idea,
      stakeholder: "claude-opus-5",
    };
    const { container: offContainer } = mount(
      <PlanningChannelEmptyState
        issue={ideaOff}
        channel="planning"
        onStarted={vi.fn()}
      />,
    );
    expect(offContainer.textContent).toContain("without your answers");
    expect(offContainer.textContent).not.toContain(
      "pauses for your approval",
    );

    const ideaOn = {
      ...idea,
      stakeholder: "claude-opus-5",
      approvePlan: true as const,
    };
    const { container: onContainer } = mount(
      <PlanningChannelEmptyState
        issue={ideaOn}
        channel="planning"
        onStarted={vi.fn()}
      />,
    );
    expect(onContainer.textContent).toContain("pauses for your approval");
    expect(onContainer.textContent).not.toContain("without your answers");
  });

  it("updates empty-state copy optimistically when the chip is toggled", async () => {
    mutateAsync.mockImplementation(() => new Promise(() => {}));
    const ideaWithStakeholder = {
      ...idea,
      stakeholder: "claude-opus-5",
    };
    const { container } = mount(
      <PlanningChannelEmptyState
        issue={ideaWithStakeholder}
        channel="planning"
        onStarted={vi.fn()}
      />,
    );
    expect(container.textContent).toContain("without your answers");

    await act(async () => {
      (
        container.querySelector(
          '[data-testid="detail-approve-plan"]',
        ) as HTMLButtonElement
      ).click();
    });

    expect(container.textContent).toContain("pauses for your approval");
    expect(container.textContent).not.toContain("without your answers");
  });
});

describe("PlanningOverviewLaunch approve plan chip", () => {
  it("hides the chip when no stakeholder is set", () => {
    const { container } = mount(<PlanningOverviewLaunch issue={idea} />);
    expect(
      container.querySelector('[data-testid="detail-approve-plan"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="planning-overview-start-session"]'),
    ).toBeTruthy();
  });

  it("shows the chip in both states when a stakeholder is set", () => {
    const ideaOff = {
      ...idea,
      stakeholder: "claude-opus-5",
    };
    const { container: offContainer } = mount(
      <PlanningOverviewLaunch issue={ideaOff} />,
    );
    const offChip = offContainer.querySelector(
      '[data-testid="detail-approve-plan"]',
    ) as HTMLButtonElement;
    expect(offChip).toBeTruthy();
    expect(offChip.textContent).toContain("off");

    const ideaOn = {
      ...idea,
      stakeholder: "claude-opus-5",
      approvePlan: true as const,
    };
    const { container: onContainer } = mount(
      <PlanningOverviewLaunch issue={ideaOn} />,
    );
    const onChip = onContainer.querySelector(
      '[data-testid="detail-approve-plan"]',
    ) as HTMLButtonElement;
    expect(onChip.textContent).toContain("on");
  });

  it("toggles approvePlan through the Idea update endpoint", async () => {
    mutateAsync.mockResolvedValueOnce({});
    const ideaWithStakeholder = {
      ...idea,
      id: "overview-toggle",
      stakeholder: "claude-opus-5",
    };
    const { container } = mount(
      <PlanningOverviewLaunch issue={ideaWithStakeholder} />,
    );

    await act(async () => {
      (
        container.querySelector(
          '[data-testid="detail-approve-plan"]',
        ) as HTMLButtonElement
      ).click();
    });

    expect(mutateAsync).toHaveBeenCalledWith({
      id: "overview-toggle",
      patch: { approvePlan: true },
    });
  });
});

describe("PlanningFlowRowLaunch approve plan chip", () => {
  it("hides the chip when no stakeholder is set", () => {
    const { container } = mount(
      <PlanningFlowRowLaunch issue={idea} />,
    );
    expect(
      container.querySelector('[data-testid="flow-row-approve-plan"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="flow-row-start-planning"]'),
    ).toBeTruthy();
  });

  it("shows the chip in the off state when a stakeholder is set", () => {
    const ideaWithStakeholder = {
      ...idea,
      id: "offline-sync",
      stakeholder: "claude-opus-5",
    };
    const { container } = mount(
      <PlanningFlowRowLaunch issue={ideaWithStakeholder} />,
    );
    const chip = container.querySelector(
      '[data-testid="flow-row-approve-plan"]',
    ) as HTMLButtonElement;
    expect(chip).toBeTruthy();
    expect(chip.textContent).toContain("Approve plan ·");
    expect(chip.textContent).toContain("off");
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    expect(chip.id).toBe("approve-plan-offline-sync");
  });

  it("shows the chip in the on state when approvePlan is set", () => {
    const ideaWithApprovePlan = {
      ...idea,
      id: "gate-me",
      stakeholder: "claude-opus-5",
      approvePlan: true as const,
    };
    const { container } = mount(
      <PlanningFlowRowLaunch issue={ideaWithApprovePlan} />,
    );
    const chip = container.querySelector(
      '[data-testid="flow-row-approve-plan"]',
    ) as HTMLButtonElement;
    expect(chip.textContent).toContain("on");
    expect(chip.getAttribute("aria-pressed")).toBe("true");
  });

  it("toggles approvePlan through the Idea update endpoint", async () => {
    mutateAsync.mockResolvedValueOnce({});
    const ideaWithStakeholder = {
      ...idea,
      id: "toggle-me",
      stakeholder: "claude-opus-5",
    };
    const { container } = mount(
      <PlanningFlowRowLaunch issue={ideaWithStakeholder} />,
    );

    await act(async () => {
      (
        container.querySelector(
          '[data-testid="flow-row-approve-plan"]',
        ) as HTMLButtonElement
      ).click();
    });

    expect(mutateAsync).toHaveBeenCalledWith({
      id: "toggle-me",
      patch: { approvePlan: true },
    });
  });

  it("assigns distinct control ids when two rows render together", () => {
    const first = {
      ...idea,
      id: "idea-a",
      stakeholder: "claude-opus-5",
    };
    const second = {
      ...idea,
      id: "idea-b",
      stakeholder: "claude-opus-5",
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <>
          <PlanningFlowRowLaunch issue={first} />
          <PlanningFlowRowLaunch issue={second} />
        </>,
      );
    });

    const chips = container.querySelectorAll(
      '[data-testid="flow-row-approve-plan"]',
    );
    expect(chips).toHaveLength(2);
    expect(chips[0]?.id).toBe("approve-plan-idea-a");
    expect(chips[1]?.id).toBe("approve-plan-idea-b");
  });
});

describe("PlanningNewRunControl", () => {
  it("renders a secondary New run action", () => {
    const { container } = mount(
      <PlanningNewRunControl
        issue={idea}
        channel="planning"
        onStarted={vi.fn()}
      />,
    );
    const button = container.querySelector(
      '[data-testid="planning-new-run"]',
    );
    expect(button?.textContent).toBe("New run");
  });

  it("asks before starting a new run when a session is mid-run", () => {
    liveRunConfirm.midRun = true;
    const onStarted = vi.fn();
    const renderControl = () => (
      <PlanningNewRunControl
        issue={idea}
        channel="planning"
        onStarted={onStarted}
      />
    );
    const { container, root } = mount(renderControl());

    act(() => {
      (
        container.querySelector(
          '[data-testid="planning-new-run"]',
        ) as HTMLButtonElement
      ).click();
    });
    act(() => {
      root.render(renderControl());
    });

    expect(mutate).not.toHaveBeenCalled();
    expect(
      container.querySelector('[data-testid="channel-kill-live-run-dialog"]'),
    ).toBeTruthy();
  });

  it("leaves the run untouched when New run confirmation is cancelled", () => {
    liveRunConfirm.midRun = true;
    const onStarted = vi.fn();
    const renderControl = () => (
      <PlanningNewRunControl
        issue={idea}
        channel="planning"
        onStarted={onStarted}
      />
    );
    const { container, root } = mount(renderControl());

    act(() => {
      (
        container.querySelector(
          '[data-testid="planning-new-run"]',
        ) as HTMLButtonElement
      ).click();
    });
    act(() => {
      root.render(renderControl());
    });
    act(() => {
      const cancel = [
        ...(container.querySelectorAll(
          '[data-testid="channel-kill-live-run-dialog"] button',
        ) as NodeListOf<HTMLButtonElement>),
      ].find((button) => button.textContent === "Cancel");
      cancel?.click();
    });

    expect(mutate).not.toHaveBeenCalled();
    expect(liveRunConfirm.pending).toBeNull();
  });

  it("posts a new session after New run confirmation is accepted", () => {
    liveRunConfirm.midRun = true;
    const onStarted = vi.fn();
    const renderControl = () => (
      <PlanningNewRunControl
        issue={idea}
        channel="planning"
        onStarted={onStarted}
      />
    );
    const { container, root } = mount(renderControl());

    act(() => {
      (
        container.querySelector(
          '[data-testid="planning-new-run"]',
        ) as HTMLButtonElement
      ).click();
    });
    act(() => {
      root.render(renderControl());
    });
    act(() => {
      (
        container.querySelector(
          '[data-testid="channel-kill-live-run-confirm"]',
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

  it("shows the planner model picker when stakeholder is unset", () => {
    const { container } = mount(
      <PlanningNewRunControl
        issue={idea}
        channel="planning"
        onStarted={vi.fn()}
      />,
    );
    const modelSelect = container.querySelector(
      '[data-testid="planning-session-model"]',
    ) as HTMLSelectElement;
    expect(modelSelect).toBeTruthy();
    expect(modelSelect.value).toBe("composer-2.5");
  });

  it("uses the selected planner model when stakeholder is unset", () => {
    const { container } = mount(
      <PlanningNewRunControl
        issue={idea}
        channel="planning"
        onStarted={vi.fn()}
      />,
    );
    const modelSelect = container.querySelector(
      '[data-testid="planning-session-model"]',
    ) as HTMLSelectElement;

    act(() => {
      modelSelect.value = "claude-opus-5";
      modelSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });

    act(() => {
      (
        container.querySelector(
          '[data-testid="planning-new-run"]',
        ) as HTMLButtonElement
      ).click();
    });

    expect(mutate).toHaveBeenCalledWith(
      {
        title: "Plan Capture",
        model: "claude-opus-5",
        message:
          `Plan capture in the issue tracker using the issue-tracker-plan skill. Read ${skillPath("issue-tracker-plan")} and follow it.`,
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("hides the picker and uses the stakeholder slug when set", () => {
    issueState.stakeholder = "claude-opus-5";
    const ideaWithStakeholder = { ...idea, stakeholder: "claude-opus-5" };
    const { container } = mount(
      <PlanningNewRunControl
        issue={ideaWithStakeholder}
        channel="planning"
        onStarted={vi.fn()}
      />,
    );
    expect(
      container.querySelector('[data-testid="planning-session-model"]'),
    ).toBeNull();

    act(() => {
      (
        container.querySelector(
          '[data-testid="planning-new-run"]',
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
