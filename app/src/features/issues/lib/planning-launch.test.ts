import { describe, expect, it } from "vitest";
import { skillPath } from "@/lib/plugin-paths";
import { planningSessionMessage } from "./planning-launch";

describe("planningSessionMessage", () => {
  it("names issue-tracker-auto-plan and the stakeholder slug when set", () => {
    expect(planningSessionMessage("capture", "claude-opus-5")).toBe(
      `Plan capture in the issue tracker using the issue-tracker-auto-plan skill. Read ${skillPath("issue-tracker-auto-plan")} and follow it. Stakeholder model: claude-opus-5.`,
    );
  });
});
