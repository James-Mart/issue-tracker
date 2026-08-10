// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MANUAL_STAKEHOLDER_LABEL } from "@server/fields";
import { IssueStakeholderField } from "./issue-stakeholder-field";

const mutateAsync = vi.fn();
const liveRunConfirm = vi.hoisted(() => ({
  midRun: false,
  pending: null as null | (() => void | Promise<void>),
  confirming: false,
  cancelConfirm: vi.fn(() => {
    liveRunConfirm.pending = null;
  }),
}));

vi.mock("@/features/agents/api/queries", () => ({
  useAgentModelsQuery: () => ({
    data: {
      models: [{ id: "claude-opus-5", displayName: "Opus 5" }],
    },
    isLoading: false,
  }),
}));

vi.mock("../api/mutations", () => ({
  useUpdateIssue: () => ({
    mutateAsync,
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
    confirmIfLiveRun: (action: () => void | Promise<void>) => {
      if (!liveRunConfirm.midRun) {
        void action();
        return;
      }
      liveRunConfirm.pending = action;
    },
    cancelConfirm: liveRunConfirm.cancelConfirm,
    awaitingConfirm: liveRunConfirm.pending !== null,
    confirming: liveRunConfirm.confirming,
    dialog:
      liveRunConfirm.pending !== null ? (
        <div data-testid="channel-kill-live-run-dialog">
          <button
            type="button"
            onClick={() => {
              liveRunConfirm.cancelConfirm();
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
    disabled,
  }: {
    value: string | undefined;
    onChange: (value: string | null) => void;
    disabled?: boolean;
  }) => (
    <select
      data-testid="stakeholder-select"
      value={value ?? "__manual__"}
      disabled={disabled}
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
  stakeholder: undefined as string | undefined,
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
  mutateAsync.mockReset();
  liveRunConfirm.midRun = false;
  liveRunConfirm.pending = null;
  liveRunConfirm.confirming = false;
  liveRunConfirm.cancelConfirm.mockClear();
});

describe("IssueStakeholderField", () => {
  it("patches stakeholder immediately when no run is in flight", async () => {
    mutateAsync.mockResolvedValue({});
    const { container } = mount(<IssueStakeholderField issue={idea} />);
    const select = container.querySelector(
      "[data-testid=stakeholder-select]",
    ) as HTMLSelectElement;

    await act(async () => {
      select.value = "claude-opus-5";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(mutateAsync).toHaveBeenCalledWith({
      id: "capture",
      patch: { stakeholder: "claude-opus-5" },
    });
  });

  it("asks before changing stakeholder while a run is in flight", async () => {
    liveRunConfirm.midRun = true;
    const { container, root } = mount(<IssueStakeholderField issue={idea} />);
    const select = () =>
      container.querySelector(
        "[data-testid=stakeholder-select]",
      ) as HTMLSelectElement;

    await act(async () => {
      select().value = "claude-opus-5";
      select().dispatchEvent(new Event("change", { bubbles: true }));
    });
    // Re-render so the mock's awaitingConfirm (pending !== null) disables the select.
    act(() => {
      root.render(<IssueStakeholderField issue={idea} />);
    });

    expect(mutateAsync).not.toHaveBeenCalled();
    expect(
      container.querySelector('[data-testid="channel-kill-live-run-dialog"]'),
    ).toBeTruthy();
    expect(select().disabled).toBe(true);
  });

  it("cancels a pending confirm when the stored stakeholder is re-selected", async () => {
    liveRunConfirm.midRun = true;
    liveRunConfirm.pending = vi.fn();
    const withStakeholder = { ...idea, stakeholder: "claude-opus-5" };
    const { container } = mount(
      <IssueStakeholderField issue={withStakeholder} />,
    );
    const select = container.querySelector(
      "[data-testid=stakeholder-select]",
    ) as HTMLSelectElement;

    await act(async () => {
      select.value = "claude-opus-5";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(liveRunConfirm.cancelConfirm).toHaveBeenCalledOnce();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("leaves the run untouched when stakeholder confirmation is cancelled", async () => {
    liveRunConfirm.midRun = true;
    const { container, root } = mount(<IssueStakeholderField issue={idea} />);
    const select = container.querySelector(
      "[data-testid=stakeholder-select]",
    ) as HTMLSelectElement;

    await act(async () => {
      select.value = "claude-opus-5";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    act(() => {
      root.render(<IssueStakeholderField issue={idea} />);
    });
    act(() => {
      const cancel = [
        ...(container.querySelectorAll(
          '[data-testid="channel-kill-live-run-dialog"] button',
        ) as NodeListOf<HTMLButtonElement>),
      ].find((button) => button.textContent === "Cancel");
      cancel?.click();
    });

    expect(mutateAsync).not.toHaveBeenCalled();
    expect(liveRunConfirm.pending).toBeNull();
  });

  it("patches stakeholder after confirmation is accepted", async () => {
    liveRunConfirm.midRun = true;
    mutateAsync.mockResolvedValue({});
    const { container, root } = mount(<IssueStakeholderField issue={idea} />);
    const select = container.querySelector(
      "[data-testid=stakeholder-select]",
    ) as HTMLSelectElement;

    await act(async () => {
      select.value = "claude-opus-5";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    act(() => {
      root.render(<IssueStakeholderField issue={idea} />);
    });
    await act(async () => {
      (
        container.querySelector(
          '[data-testid="channel-kill-live-run-confirm"]',
        ) as HTMLButtonElement
      ).click();
    });

    expect(mutateAsync).toHaveBeenCalledWith({
      id: "capture",
      patch: { stakeholder: "claude-opus-5" },
    });
  });
});
