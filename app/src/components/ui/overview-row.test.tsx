// @vitest-environment happy-dom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OverviewRow } from "./overview-row";

const coarsePointer = vi.hoisted(() => ({ value: false }));

vi.mock("@/hooks/use-coarse-pointer", () => ({
  useIsCoarsePointer: () => coarsePointer.value,
}));

function mountRow(
  overrides: Partial<ComponentProps<typeof OverviewRow>> = {},
): {
  container: HTMLDivElement;
  root: Root;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter>
        <OverviewRow
          overlay={<button type="button">Action</button>}
          touchMenu={<div role="menuitem">Menu action</div>}
          {...overrides}
        >
          Row title
        </OverviewRow>
      </MemoryRouter>,
    );
  });
  return { container, root };
}

function overlayShell(container: ParentNode): HTMLElement {
  const shell = container.querySelector(".pointer-events-none");
  expect(shell).toBeTruthy();
  return shell as HTMLElement;
}

function touchTrigger(container: ParentNode): HTMLButtonElement {
  const button = container.querySelector('button[title="Row actions"]');
  expect(button).toBeTruthy();
  return button as HTMLButtonElement;
}

afterEach(() => {
  document.body.innerHTML = "";
  coarsePointer.value = false;
});

describe("OverviewRow overlay", () => {
  it("hides the hover overlay until group hover or focus on fine pointers", () => {
    coarsePointer.value = false;
    const { container } = mountRow();
    const shell = overlayShell(container);

    expect(shell.className).toMatch(/\bopacity-0\b/);
    expect(shell.className).toMatch(/group-hover:opacity-100/);
    expect(container.querySelector('button[title="Row actions"]')).toBeNull();
  });

  it("renders a touch overflow trigger instead of the hover overlay on coarse pointers", () => {
    coarsePointer.value = true;
    const { container } = mountRow();
    const button = touchTrigger(container);

    expect(container.querySelector(".pointer-events-none")).toBeNull();
    expect(button.className).toMatch(/\bh-11\b/);
    expect(button.className).toMatch(/\bw-11\b/);
  });

  it("does not add group when overlayGroup is false", () => {
    coarsePointer.value = false;
    const { container } = mountRow({ overlayGroup: false });
    const row = container.firstElementChild as HTMLElement;

    expect(row.className).not.toMatch(/\bgroup\b/);
  });

  it("renders at-rest chips after the title", () => {
    const { container } = mountRow({
      chips: <span data-testid="planning-chip">planning</span>,
    });
    expect(container.querySelector('[data-testid="planning-chip"]')).toBeTruthy();
    expect(container.textContent).toContain("planning");
  });

  it("stretches a drill-in link across the card while keeping overlay above it", () => {
    coarsePointer.value = false;
    const { container } = mountRow({
      drillInTo: "/projects/p/issues/e",
      drillInLabel: "Epic title",
    });
    const link = container.querySelector('a[aria-label="Epic title"]');
    expect(link).toBeTruthy();
    expect(link?.className).toMatch(/\binset-0\b/);
    expect(container.querySelector(".pointer-events-none")).toBeTruthy();
  });

  it("renders inline actions after count in the flex line", () => {
    const { container } = mountRow({
      count: "3/4",
      actions: <button type="button">Inline action</button>,
      overlay: undefined,
      touchMenu: undefined,
    });
    const flexLine = container.querySelector(".min-w-0.flex-1.truncate")
      ?.parentElement as HTMLElement;
    expect(flexLine).toBeTruthy();
    expect(flexLine.textContent).toContain("Inline action");
    expect(flexLine.textContent).toContain("3/4");
    const actionButton = container.querySelector('button[type="button"]');
    expect(actionButton?.textContent).toBe("Inline action");
    expect(actionButton?.closest(".shrink-0")).toBeTruthy();
    expect(container.querySelector(".pointer-events-none")).toBeNull();
  });

  it("keeps inline actions clickable when drillInTo is set", () => {
    const { container } = mountRow({
      drillInTo: "/projects/p/issues/e",
      drillInLabel: "Epic title",
      actions: <button type="button">Inline action</button>,
      overlay: undefined,
      touchMenu: undefined,
    });
    const actionWrapper = container
      .querySelector('button[type="button"]')
      ?.closest(".shrink-0") as HTMLElement;
    expect(actionWrapper).toBeTruthy();
    expect(actionWrapper.className).toMatch(/pointer-events-auto/);
  });
});
