// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IssueRecord, ProjectLabel } from "@server/schemas";
import { IssueAssignmentLabelsField } from "./issue-assignment-labels-field";

const mutateAsync = vi.fn();
const activeRoots: Root[] = [];

vi.mock("../api/mutations", () => ({
  useUpdateIssue: () => ({ mutateAsync }),
}));

const catalog: ProjectLabel[] = [
  { id: "bug", color: "#ef4444", description: "Defect" },
  { id: "enhancement", color: "#22c55e", description: "Improvement" },
  { id: "meta-confusion", color: "#a855f7", description: "Confusing meta" },
];

const story: Extract<IssueRecord, { kind: "story" }> = {
  kind: "story",
  id: "edit-labels-story",
  title: "Edit labels",
  partOf: "platform",
  order: 0,
  archived: false,
  needsAttention: false,
  attentionReason: null,
  merged: false,
  reviewedTasks: [],
  createdAt: "2026-08-10T12:00:00.000Z",
  updatedAt: "2026-08-10T12:00:00.000Z",
  labels: ["bug", "meta-confusion"],
};

function mount(
  ui: React.ReactElement,
): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  activeRoots.push(root);
  act(() => {
    root.render(ui);
  });
  return { container, root };
}

async function unmountAll() {
  while (activeRoots.length > 0) {
    const root = activeRoots.pop()!;
    await act(async () => {
      root.unmount();
    });
  }
  document.body.innerHTML = "";
}

function editLabelsTrigger(container: ParentNode): HTMLButtonElement | null {
  const match = container.querySelector('[aria-label="Edit labels"]');
  return match instanceof HTMLButtonElement ? match : null;
}

function menuCheckbox(labelId: string): HTMLElement | null {
  return (
    Array.from(
      document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]'),
    ).find((el) => el.textContent?.includes(labelId)) ?? null
  );
}

async function openEditLabelsMenu(
  container: ParentNode,
): Promise<HTMLButtonElement> {
  const trigger = editLabelsTrigger(container);
  expect(trigger).toBeTruthy();
  if (trigger!.getAttribute("data-state") !== "open") {
    await act(async () => {
      trigger!.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          pointerId: 1,
          pointerType: "mouse",
        }),
      );
      trigger!.click();
    });
  }
  return trigger!;
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await unmountAll();
  mutateAsync.mockReset();
});

describe("IssueAssignmentLabelsField", () => {
  it("does not send a second PATCH while a save is in flight", async () => {
    let resolveFirst: (() => void) | undefined;
    mutateAsync.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveFirst = resolve;
        }),
    );

    const { container } = mount(
      <IssueAssignmentLabelsField issue={story} catalog={catalog} />,
    );

    await openEditLabelsMenu(container);

    await act(async () => {
      menuCheckbox("bug")!.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(editLabelsTrigger(container)?.disabled).toBe(true);

    await act(async () => {
      menuCheckbox("enhancement")!.click();
    });
    expect(mutateAsync).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst?.();
    });
  });
});
