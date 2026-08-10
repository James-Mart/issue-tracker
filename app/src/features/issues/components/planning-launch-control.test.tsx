// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MANUAL_STAKEHOLDER_LABEL } from "@server/fields";
import {
  PlanningChannelEmptyState,
  PlanningNewRunControl,
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
          "Plan capture in the issue tracker using the issue-tracker-plan skill.",
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
          "Plan capture in the issue tracker using the issue-tracker-auto-plan skill. Stakeholder stand-in model: claude-opus-5.",
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
});
