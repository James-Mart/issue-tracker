// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buttonVariants } from "@/components/ui/button";
import { RemoveWorktreeConfirmDialog } from "./remove-worktree-confirm-dialog";

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

describe("RemoveWorktreeConfirmDialog", () => {
  it("names the path and description", () => {
    mount(
      <RemoveWorktreeConfirmDialog
        open
        path="/root/issue-tracker-worktrees/p/s"
        description="This permanently deletes the isolated checkout."
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    const dialog = document.body.querySelector(
      '[data-testid="remove-worktree-confirm-dialog"]',
    );
    expect(dialog?.textContent).toContain("Remove worktree?");
    expect(dialog?.textContent).toContain(
      "This permanently deletes the isolated checkout.",
    );
    expect(
      document.body.querySelector('[data-testid="remove-worktree-confirm-path"]')
        ?.textContent,
    ).toBe("/root/issue-tracker-worktrees/p/s");
  });

  it("invokes onConfirm from the destructive action", () => {
    const onConfirm = vi.fn();
    mount(
      <RemoveWorktreeConfirmDialog
        open
        path="/tmp/wt"
        description="discard these counts"
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    const confirm = document.body.querySelector(
      '[data-testid="remove-worktree-confirm"]',
    ) as HTMLButtonElement;
    const shared = buttonVariants({ variant: "destructive" });
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
      <RemoveWorktreeConfirmDialog
        open
        path="/tmp/wt"
        description="discard these counts"
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
