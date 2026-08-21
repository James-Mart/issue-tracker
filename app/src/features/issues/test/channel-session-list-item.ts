import type { ChannelSessionListItem } from "@server/schemas";

/** Shared defaults for ChannelSessionListItem test fixtures. */
export function channelSessionListItem(
  overrides: Partial<ChannelSessionListItem> &
    Pick<ChannelSessionListItem, "id">,
): ChannelSessionListItem {
  return {
    title: "Session",
    model: "composer-2.5-fast",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    archived: false,
    activeRun: false,
    awaitingHuman: false,
    ...overrides,
  };
}
