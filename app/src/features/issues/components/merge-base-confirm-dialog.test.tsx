// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buttonVariants } from "@/components/ui/button";
import { MergeBaseConfirmDialog } from "./merge-base-confirm-dialog";

function mount(ui: React.ReactElement): { root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  return { root };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("MergeBaseConfirmDialog", () => {
  it("names the Story branch and the merge base", () => {
    mount(
      <MergeBaseConfirmDialog
        open
        mergeBase="main @ c4d91e2"
        branchName="story/stack-rebase-helper"
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    const dialog = document.body.querySelector(
      '[data-testid="merge-base-confirm-dialog"]',
    );
    expect(dialog?.textContent).toContain("Update from merge base?");
    expect(dialog?.textContent).toContain("main @ c4d91e2");
    expect(dialog?.textContent).toContain("story/stack-rebase-helper");
  });

  it("invokes onConfirm from the current-variant action", () => {
    const onConfirm = vi.fn();
    mount(
      <MergeBaseConfirmDialog
        open
        mergeBase="main @ c4d91e2"
        branchName="story/stack-rebase-helper"
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    const confirm = document.body.querySelector(
      '[data-testid="merge-base-confirm"]',
    ) as HTMLButtonElement;
    const shared = buttonVariants({ variant: "current" });
    expect(confirm.className.split(/\s+/)).toEqual(
      expect.arrayContaining(shared.split(/\s+/)),
    );
    act(() => {
      confirm.click();
    });
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("closes without confirming from Cancel", () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    mount(
      <MergeBaseConfirmDialog
        open
        mergeBase="main @ c4d91e2"
        branchName="story/stack-rebase-helper"
        onOpenChange={onOpenChange}
        onConfirm={onConfirm}
      />,
    );
    act(() => {
      const cancel = [...document.body.querySelectorAll("button")].find(
        (button) => button.textContent === "Cancel",
      );
      cancel?.click();
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
