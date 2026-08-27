// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IssueDetail } from "@server/schemas";
import { DeletePartialPlanDetailAction } from "./delete-partial-plan-control";

const deletePartialPlanMutate = vi.fn();

vi.mock("../api/mutations", () => ({
  useDeletePartialPlan: () => ({
    mutate: deletePartialPlanMutate,
    isPending: false,
  }),
}));

const t0 = "2026-07-01T00:00:00.000Z";

function idea(id: string): Extract<IssueDetail, { kind: "idea" }> {
  return {
    id,
    kind: "idea",
    title: `Idea ${id}`,
    partOf: "project-a",
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    archived: false,
    description: "",
    labels: [],
  };
}

function mountAction(issue: Extract<IssueDetail, { kind: "idea" }>): {
  container: HTMLDivElement;
  root: Root;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<DeletePartialPlanDetailAction issue={issue} />);
  });
  return { container, root };
}

afterEach(() => {
  document.body.innerHTML = "";
  deletePartialPlanMutate.mockReset();
});

describe("DeletePartialPlanDetailAction", () => {
  it("renders a labeled destructive action", () => {
    const { container } = mountAction(idea("stalled"));
    const button = container.querySelector(
      '[data-testid="idea-detail-delete-partial-plan"]',
    ) as HTMLButtonElement;
    expect(button).toBeTruthy();
    expect(button.textContent).toContain("Delete partial plan");
    expect(button.className).toContain("text-destructive");
  });

  it("opens the confirmation dialog before deleting", () => {
    const { container } = mountAction(idea("stalled"));

    act(() => {
      (
        container.querySelector(
          '[data-testid="idea-detail-delete-partial-plan"]',
        ) as HTMLButtonElement
      ).click();
    });

    expect(
      document.body.querySelector('[data-testid="delete-partial-plan-dialog"]'),
    ).toBeTruthy();

    deletePartialPlanMutate.mockImplementation((_input, options) => {
      options?.onSuccess?.();
    });

    act(() => {
      const deleteButton = document.body.querySelector(
        '[data-testid="delete-partial-plan-dialog"] button:last-of-type',
      ) as HTMLButtonElement;
      deleteButton.click();
    });

    expect(deletePartialPlanMutate).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });
});
