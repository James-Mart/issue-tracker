import { expect, it } from "vitest";
import type { Issue } from "@server/schemas";
import { outlineOffersMockupsTab, tabsForIssueDetail } from "./issue-detail-tabs";

const outline = {
  id: "spec",
  kind: "outline",
  partOf: "p",
  title: "Spec",
  bodyVersion: 1,
  order: 0,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
} as Issue;

it("hides Mockups until the outline has a session or something to restore", () => {
  expect(tabsForIssueDetail(outline).map((tab) => tab.key)).toEqual([
    "overview",
    "planning",
    "decomposition",
  ]);
  expect(
    tabsForIssueDetail(outline, undefined, { showMockups: true }).map((tab) => tab.key),
  ).toEqual(["overview", "planning", "decomposition", "mockups"]);
});

it("offers the tab for a forked session, a restorable stack, or a saved direction", () => {
  expect(
    outlineOffersMockupsTab({
      canRestore: false,
      directions: [],
    }),
  ).toBe(false);
  expect(
    outlineOffersMockupsTab({
      sessionId: "agent-mockup",
      canRestore: false,
      directions: [],
    }),
  ).toBe(true);
  expect(
    outlineOffersMockupsTab({
      canRestore: false,
      directions: ["split-index-canvas"],
    }),
  ).toBe(true);
});
