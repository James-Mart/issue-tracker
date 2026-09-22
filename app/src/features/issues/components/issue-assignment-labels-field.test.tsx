// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import type { ProjectLabel } from "@server/schemas";
import { IssueAssignmentLabelsField } from "./issue-assignment-labels-field";

const mutateAsync = vi.fn();
const activeRoots: Root[] = [];

vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

vi.mock("../api/mutations", () => ({
  useUpdateIssue: () => ({
    mutateAsync: async (...args: unknown[]) => {
      try {
        return await mutateAsync(...args);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Request failed");
        throw err;
      }
    },
  }),
}));


const catalog: ProjectLabel[] = [
  { id: "bug", color: "#ef4444", description: "Defect" },
  { id: "enhancement", color: "#22c55e", description: "Improvement" },
  { id: "meta-confusion", color: "#a855f7", description: "Confusing meta" },
];

const story = {
  kind: "story" as const,
  id: "edit-labels-story",
  title: "Edit labels",
  partOf: "platform",
  order: 0,
  archived: false,
  createdAt: "2026-08-10T12:00:00.000Z",
  updatedAt: "2026-08-10T12:00:00.000Z",
  labels: ["bug", "meta-confusion"] as string[],
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

function chipIds(container: HTMLElement): string[] {
  return [...container.querySelectorAll("span.font-mono")].map(
    (el) => el.textContent ?? "",
  );
}

function editLabelsTrigger(container: ParentNode): HTMLButtonElement | null {
  const match = container.querySelector('[aria-label="Edit labels"]');
  return match instanceof HTMLButtonElement ? match : null;
}

function menuCheckbox(labelId: string): HTMLElement | null {
  return (
    Array.from(
      document.querySelectorAll('[role="menuitemcheckbox"]'),
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
  vi.mocked(toast.error).mockReset();
});

describe("IssueAssignmentLabelsField", () => {
  it("opens Edit labels with every catalog label and checks saved assignment", async () => {
    const { container } = mount(
      <IssueAssignmentLabelsField issue={story} catalog={catalog} />,
    );

    await openEditLabelsMenu(container);

    expect(menuCheckbox("bug")?.getAttribute("aria-checked")).toBe("true");
    expect(menuCheckbox("meta-confusion")?.getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(menuCheckbox("enhancement")?.getAttribute("aria-checked")).toBe(
      "false",
    );
  });

  it("toggles a label off, PATCHes without that id, and keeps the menu open", async () => {
    mutateAsync.mockResolvedValue({ ...story, labels: ["meta-confusion"] });
    const { container } = mount(
      <IssueAssignmentLabelsField issue={story} catalog={catalog} />,
    );

    await openEditLabelsMenu(container);

    await act(async () => {
      menuCheckbox("bug")!.click();
    });

    expect(mutateAsync).toHaveBeenCalledWith({
      id: "edit-labels-story",
      patch: { labels: ["meta-confusion"] },
    });
    expect(editLabelsTrigger(container)?.getAttribute("data-state")).toBe(
      "open",
    );
    expect(
      document.querySelectorAll('[role="menuitemcheckbox"]').length,
    ).toBe(3);
  });

  it("toggles a label on, PATCHes with that id, and keeps the menu open", async () => {
    const issue = { ...story, labels: ["bug"] as string[] };
    mutateAsync.mockResolvedValue({ ...issue, labels: ["bug", "enhancement"] });
    const { container } = mount(
      <IssueAssignmentLabelsField issue={issue} catalog={catalog} />,
    );

    await openEditLabelsMenu(container);

    await act(async () => {
      menuCheckbox("enhancement")!.click();
    });

    expect(mutateAsync).toHaveBeenCalledWith({
      id: "edit-labels-story",
      patch: { labels: ["bug", "enhancement"] },
    });
    expect(editLabelsTrigger(container)?.getAttribute("data-state")).toBe(
      "open",
    );
  });

  it("leaves chips and checks on the saved assignment and shows the error when PATCH fails", async () => {
    mutateAsync.mockRejectedValue(new Error("Network error"));
    const { container } = mount(
      <IssueAssignmentLabelsField issue={story} catalog={catalog} />,
    );

    await openEditLabelsMenu(container);

    await act(async () => {
      menuCheckbox("bug")!.click();
      await Promise.resolve();
    });

    expect(chipIds(container)).toEqual(["bug", "meta-confusion"]);
    expect(menuCheckbox("bug")?.getAttribute("aria-checked")).toBe("true");
    expect(container.textContent).toContain("Network error");
    expect(toast.error).toHaveBeenCalledWith("Network error");
  });

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
