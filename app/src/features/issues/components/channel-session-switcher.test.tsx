// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChannelSessionListItem } from "@server/schemas";
import { ChannelSessionSwitcher } from "./channel-session-switcher";
import { channelSessionListItem } from "../test/channel-session-list-item";

const mutate = vi.hoisted(() => vi.fn());

vi.mock("../api/mutations", () => ({
  useDeleteChannelSession: () => ({
    mutate,
    isPending: false,
  }),
}));

const sessions: ChannelSessionListItem[] = [
  channelSessionListItem({
    id: "live",
    title: "Live",
    updatedAt: "2026-08-02T00:00:00.000Z",
  }),
  channelSessionListItem({
    id: "archived",
    title: "Old",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    archived: true,
  }),
];

function mountSwitcher(
  selectedId: string,
  onSelectedIdChange: (id: string) => void,
): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <ChannelSessionSwitcher
        issueId="capture"
        channel="planning"
        sessions={sessions}
        selectedId={selectedId}
        onSelectedIdChange={onSelectedIdChange}
      />,
    );
  });
  return { container, root };
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
});
