// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IssueDetail } from "@server/schemas";
import { OutlineBodyCard } from "./outline-body-card";

const update = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  isPending: false,
}));

vi.mock("../api/mutations", () => ({
  useUpdateIssue: () => update,
}));

vi.mock("../api/queries", () => ({
  useOutlineBodyQuery: () => ({
    isPending: false,
    error: null,
    data: undefined,
  }),
  useOutlineDiffQuery: () => ({
    isPending: false,
    error: null,
    data: undefined,
  }),
  useIssuesQuery: () => ({
    data: { issues: [], derived: {} },
    error: null,
  }),
}));

const t0 = "2026-08-10T12:00:00.000Z";
const saved = "# Plan\n\nKeep the seams.\n";

function outline(): Extract<IssueDetail, { kind: "outline" }> {
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
    description: saved,
    version: "1",
  };
}

let root: Root | undefined;

function mount(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<MemoryRouter>{node}</MemoryRouter>);
  });
  return container;
}

function button(container: ParentNode, testId: string): HTMLButtonElement {
  const el = container.querySelector(`[data-testid="${testId}"]`);
  if (!(el instanceof HTMLButtonElement)) {
    throw new Error(`missing ${testId}`);
  }
  return el;
}

function setDraft(input: HTMLTextAreaElement, value: string) {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )!.set!;
  act(() => {
    nativeInputValueSetter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  update.mutateAsync.mockReset();
  update.isPending = false;
});

describe("Outline body edit", () => {
  it("saves the edited latest markdown as the next version", async () => {
    update.mutateAsync.mockResolvedValue(undefined);
    const editing = vi.fn();
    const container = mount(
      <OutlineBodyCard issue={outline()} onEditingChange={editing} />,
    );

    expect(button(container, "outline-edit").textContent).toContain("Edit");
    expect(container.querySelector('[data-testid="outline-compare"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="outline-version"]')).toBeTruthy();

    act(() => {
      button(container, "outline-edit").click();
    });
    expect(container.querySelector('[data-testid="outline-new-version"]')?.textContent).toBe(
      "New version v4",
    );
    const field = container.querySelector(
      '[data-testid="outline-edit-body"]',
    ) as HTMLTextAreaElement;
    expect(field.value).toBe(saved);
    expect(button(container, "outline-edit-save").disabled).toBe(true);
    expect(editing).toHaveBeenCalledWith(true);

    setDraft(field, `${saved}\nAnother seam.\n`);
    expect(button(container, "outline-edit-save").disabled).toBe(false);
    expect(button(container, "outline-edit-save").textContent).toContain("Save as v4");

    await act(async () => {
      button(container, "outline-edit-save").click();
    });

    expect(update.mutateAsync).toHaveBeenCalledWith({
      id: "spec",
      patch: { description: `${saved}\nAnother seam.\n` },
    });
    expect(container.querySelector('[data-testid="outline-edit-body"]')).toBeNull();
    expect(container.querySelector('[data-testid="outline-edit"]')).toBeTruthy();
    expect(editing).toHaveBeenLastCalledWith(false);
  });
});
