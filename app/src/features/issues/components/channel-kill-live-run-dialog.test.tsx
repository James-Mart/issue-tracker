// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChannelSessionListItem } from "@server/schemas";
import { ChannelKillLiveRunDialog } from "./channel-kill-live-run-dialog";

const session: ChannelSessionListItem = {
  id: "live-1",
  title: "Plan Capture",
  model: "composer-2.5",
  createdAt: "2026-08-02T15:30:00.000Z",
  updatedAt: "2026-08-02T15:30:00.000Z",
  archived: false,
  activeRun: true,
};

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

describe("ChannelKillLiveRunDialog", () => {
  it("names the session that will be killed and archived", () => {
    mount(
      <ChannelKillLiveRunDialog
        open
        session={session}
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    const dialog = document.body.querySelector(
      '[data-testid="channel-kill-live-run-dialog"]',
    );
    expect(dialog?.textContent).toContain("Kill live run?");
    expect(dialog?.textContent).toMatch(/started/);
    expect(dialog?.textContent).toContain("session switcher");
  });

  it("invokes onConfirm from the destructive action", () => {
    const onConfirm = vi.fn();
    mount(
      <ChannelKillLiveRunDialog
        open
        session={session}
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    act(() => {
      (
        document.body.querySelector(
          '[data-testid="channel-kill-live-run-confirm"]',
        ) as HTMLButtonElement
      ).click();
    });
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("shows a retire error when provided", () => {
    mount(
      <ChannelKillLiveRunDialog
        open
        session={session}
        error="cancel failed"
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(
      document.body.querySelector('[data-testid="channel-kill-live-run-error"]')
        ?.textContent,
    ).toBe("cancel failed");
  });
});
