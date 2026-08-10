import { describe, expect, it } from "vitest";
import type { ChannelSessionListItem } from "@server/schemas";
import {
  currentChannelSession,
  defaultChannelSession,
  formatChannelSessionSwitcherLabel,
  orderChannelSessionsForSwitcher,
} from "./channel-sessions";

function session(
  overrides: Partial<ChannelSessionListItem> & Pick<ChannelSessionListItem, "id">,
): ChannelSessionListItem {
  return {
    title: "Session",
    model: "composer-2.5-fast",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    archived: false,
    activeRun: false,
    ...overrides,
  };
}

describe("currentChannelSession", () => {
  it("returns the first non-archived session (list is updatedAt desc)", () => {
    const sessions = [
      session({ id: "newer-archived", archived: true, updatedAt: "2026-08-03T00:00:00.000Z" }),
      session({ id: "current", updatedAt: "2026-08-02T00:00:00.000Z" }),
      session({ id: "older", updatedAt: "2026-08-01T00:00:00.000Z" }),
    ];
    expect(currentChannelSession(sessions)?.id).toBe("current");
  });

  it("returns undefined when every session is archived", () => {
    expect(
      currentChannelSession([
        session({ id: "a", archived: true }),
        session({ id: "b", archived: true }),
      ]),
    ).toBeUndefined();
  });

  it("returns undefined for an empty list", () => {
    expect(currentChannelSession([])).toBeUndefined();
  });
});

describe("defaultChannelSession", () => {
  it("prefers the live session over archived history", () => {
    const sessions = [
      session({ id: "archived", archived: true, updatedAt: "2026-08-03T00:00:00.000Z" }),
      session({ id: "live", updatedAt: "2026-08-02T00:00:00.000Z" }),
    ];
    expect(defaultChannelSession(sessions)?.id).toBe("live");
  });

  it("falls back to the newest session when every session is archived", () => {
    const sessions = [
      session({
        id: "newer-archived",
        archived: true,
        updatedAt: "2026-08-03T00:00:00.000Z",
      }),
      session({
        id: "older-archived",
        archived: true,
        updatedAt: "2026-08-02T00:00:00.000Z",
      }),
    ];
    expect(defaultChannelSession(sessions)?.id).toBe("newer-archived");
  });
});

describe("orderChannelSessionsForSwitcher", () => {
  it("lists active sessions before archived, each group newest-first", () => {
    const sessions = [
      session({
        id: "archived-newer",
        archived: true,
        updatedAt: "2026-08-04T00:00:00.000Z",
        createdAt: "2026-08-04T00:00:00.000Z",
      }),
      session({
        id: "live",
        updatedAt: "2026-08-03T00:00:00.000Z",
        createdAt: "2026-08-03T00:00:00.000Z",
      }),
      session({
        id: "archived-older",
        archived: true,
        updatedAt: "2026-08-02T00:00:00.000Z",
        createdAt: "2026-08-02T00:00:00.000Z",
      }),
    ];
    expect(orderChannelSessionsForSwitcher(sessions).map((s) => s.id)).toEqual([
      "live",
      "archived-newer",
      "archived-older",
    ]);
  });
});

describe("formatChannelSessionSwitcherLabel", () => {
  it("includes an archived marker for archived sessions", () => {
    const label = formatChannelSessionSwitcherLabel(
      session({
        id: "a",
        archived: true,
        createdAt: "2026-08-01T12:00:00.000Z",
      }),
    );
    expect(label).toContain("archived");
    expect(label).not.toMatch(/ · archived · archived/);
  });

  it("omits the archived marker for the live session", () => {
    expect(
      formatChannelSessionSwitcherLabel(
        session({ id: "a", createdAt: "2026-08-01T12:00:00.000Z" }),
      ),
    ).not.toContain("archived");
  });
});
