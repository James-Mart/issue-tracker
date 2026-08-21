// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChannelSessionListItem } from "@server/schemas";
import { ChannelSessionSwitcher } from "./channel-session-switcher";

const mutate = vi.hoisted(() => vi.fn());

vi.mock("../api/mutations", () => ({
  useDeleteChannelSession: () => ({
    mutate,
    isPending: false,
  }),
}));

const sessions: ChannelSessionListItem[] = [
  {
    id: "live",
    title: "Live",
    model: "composer-2.5-fast",
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
    archived: false,
    activeRun: false,
  },
  {
    id: "archived",
    title: "Old",
    model: "composer-2.5-fast",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    archived: true,
    activeRun: false,
  },
];

function mountSwitcher(
  selectedId = "archived",
  onSelectedIdChange = vi.fn(),
  options?: { showSelect?: boolean; sessions?: ChannelSessionListItem[] },
): { container: HTMLDivElement; root: Root; onSelectedIdChange: ReturnType<typeof vi.fn> } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <ChannelSessionSwitcher
        issueId="capture"
        channel="planning"
        sessions={options?.sessions ?? sessions}
        selectedId={selectedId}
        onSelectedIdChange={onSelectedIdChange}
        showSelect={options?.showSelect}
      />,
    );
  });
  return { container, root, onSelectedIdChange };
}

afterEach(() => {
  document.body.innerHTML = "";
  mutate.mockClear();
});

describe("ChannelSessionSwitcher", () => {
  it("confirms before deleting a session", () => {
    const onSelectedIdChange = vi.fn();
    const { container } = mountSwitcher("archived", onSelectedIdChange);

    act(() => {
      (
        container.querySelector(
          '[data-testid="channel-session-delete"]',
        ) as HTMLButtonElement
      ).click();
    });
    expect(
      document.body.querySelector('[data-testid="delete-channel-session-dialog"]'),
    ).toBeTruthy();

    mutate.mockImplementation((_id, options) => {
      options?.onSuccess?.();
    });

    act(() => {
      const deleteButton = document.body.querySelector(
        '[data-testid="delete-channel-session-dialog"] button:last-of-type',
      ) as HTMLButtonElement;
      deleteButton.click();
    });

    expect(mutate).toHaveBeenCalledWith("archived", expect.any(Object));
    expect(onSelectedIdChange).toHaveBeenCalledWith("live");
  });

  it("hides the session select but keeps delete when showSelect is false", () => {
    const soloSession = sessions.filter((session) => session.id === "live");
    const { container } = mountSwitcher("live", vi.fn(), {
      showSelect: false,
      sessions: soloSession,
    });

    expect(
      container.querySelector('[data-testid="channel-session-select"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="channel-session-delete"]'),
    ).toBeTruthy();
  });

  it("deletes the last remaining session without changing selection", () => {
    const soloSession = sessions.filter((session) => session.id === "live");
    const onSelectedIdChange = vi.fn();
    const { container } = mountSwitcher("live", onSelectedIdChange, {
      showSelect: false,
      sessions: soloSession,
    });

    act(() => {
      (
        container.querySelector(
          '[data-testid="channel-session-delete"]',
        ) as HTMLButtonElement
      ).click();
    });

    mutate.mockImplementation((_id, options) => {
      options?.onSuccess?.();
    });

    act(() => {
      const deleteButton = document.body.querySelector(
        '[data-testid="delete-channel-session-dialog"] button:last-of-type',
      ) as HTMLButtonElement;
      deleteButton.click();
    });

    expect(mutate).toHaveBeenCalledWith("live", expect.any(Object));
    expect(onSelectedIdChange).not.toHaveBeenCalled();
  });
});
