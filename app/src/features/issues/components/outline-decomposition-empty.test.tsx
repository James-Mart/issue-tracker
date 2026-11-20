// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IssueDetail, IssueRecord } from "@server/schemas";
import { OutlineDecompositionEmptyState } from "./outline-decomposition-empty";

const mutateAsync = vi.fn();
const decomposeAsync = vi.fn();

const fixtures = vi.hoisted(() => ({
  issues: {
    data: {
      issues: [] as IssueRecord[],
      derived: {} as Record<string, { blocked: boolean }>,
    } as
      | { issues: IssueRecord[]; derived: Record<string, { blocked: boolean }> }
      | undefined,
    isLoading: false,
  },
}));

vi.mock("../api/mutations", () => ({
  useUpdateIssue: () => ({ mutateAsync }),
  useDecomposeOutline: () => ({ mutateAsync: decomposeAsync }),
}));

vi.mock("../api/queries", () => ({
  useIssuesQuery: () => fixtures.issues,
}));

const t0 = "2026-08-10T12:00:00.000Z";

function outline(
  patch: Partial<Extract<IssueDetail, { kind: "outline" }>> = {},
): Extract<IssueDetail, { kind: "outline" }> {
  return {
    kind: "outline",
    id: "spec",
    title: "Feature outline",
    partOf: "platform",
    bodyVersion: 3,
    archived: false,
    order: 0,
    concludedAt: "2026-08-11T00:00:00.000Z",
    executionGate: true,
    outOfBand: false,
    createdAt: t0,
    updatedAt: t0,
    description: "",
    version: "1",
    ...patch,
  };
}

function mount(issue: Extract<IssueDetail, { kind: "outline" }>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <OutlineDecompositionEmptyState label="Decomposition" outline={issue} />,
    );
  });
  return { container, root };
}

function click(container: HTMLElement, testId: string) {
  return act(async () => {
    (container.querySelector(`[data-testid="${testId}"]`) as HTMLButtonElement).click();
  });
}

afterEach(() => {
  document.body.innerHTML = "";
  mutateAsync.mockReset();
  decomposeAsync.mockReset();
  fixtures.issues.data = { issues: [], derived: {} };
  fixtures.issues.isLoading = false;
});

describe("Outline decomposition empty state", () => {
  it("saves the chosen execution gate, then starts with an empty body", async () => {
    const order: string[] = [];
    mutateAsync.mockImplementation(async () => {
      order.push("patch");
    });
    decomposeAsync.mockImplementation(async () => {
      order.push("decompose");
    });
    const { container } = mount(outline());

    expect(
      container
        .querySelector('[data-testid="outline-execution-gate"]')
        ?.getAttribute("data-value"),
    ).toBe("on");
    expect(container.textContent).toContain("waits for a human start");

    await click(container, "outline-execution-gate-off");
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(container.textContent).toContain("starts roots when decompose finishes");

    await click(container, "outline-decompose");
    expect(order).toEqual(["patch", "decompose"]);
    expect(mutateAsync).toHaveBeenCalledWith({
      id: "spec",
      patch: { executionGate: false },
    });
    expect(decomposeAsync).toHaveBeenCalledWith();
  });
});
