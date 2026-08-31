import { describe, expect, it } from "vitest";
import { skillPath } from "@/lib/plugin-paths";
import {
  defaultConversationModel,
  planningLaunchCopy,
  planningSessionMessage,
  planningSessionModel,
  planningSessionTitle,
} from "./planning-launch";

describe("planningSessionTitle", () => {
  it("templates the title from the Idea title", () => {
    expect(planningSessionTitle("Capture")).toBe("Plan Capture");
  });
});

describe("planningSessionModel", () => {
  it("uses the default conversation model when stakeholder is unset", () => {
    expect(planningSessionModel(undefined, "composer-2.5")).toBe("composer-2.5");
  });

  it("uses the stakeholder slug when set", () => {
    expect(planningSessionModel("claude-opus-5", "composer-2.5")).toBe(
      "claude-opus-5",
    );
  });
});

describe("planningSessionMessage", () => {
  it("names issue-tracker-plan when stakeholder is unset", () => {
    expect(planningSessionMessage("capture", undefined)).toBe(
      `Plan capture in the issue tracker using the issue-tracker-plan skill. Read ${skillPath("issue-tracker-plan")} and follow it.`,
    );
  });

  it("names issue-tracker-auto-plan and the stakeholder slug when set", () => {
    expect(planningSessionMessage("capture", "claude-opus-5")).toBe(
      `Plan capture in the issue tracker using the issue-tracker-auto-plan skill. Read ${skillPath("issue-tracker-auto-plan")} and follow it. Stakeholder model: claude-opus-5.`,
    );
  });
});

describe("planningLaunchCopy", () => {
  const models = [
    { id: "composer-2.5", displayName: "Composer 2.5" },
    { id: "claude-opus-5", displayName: "Opus 5" },
  ];

  it("describes a manual grill when stakeholder is unset", () => {
    const copy = planningLaunchCopy(undefined, models);
    expect(copy.actionLabel).toBe("Start planning grill");
    expect(copy.detail).toContain("you answer");
  });

  it("describes auto-plan on the named model when a slug is set", () => {
    const copy = planningLaunchCopy("claude-opus-5", models);
    expect(copy.actionLabel).toBe("Start auto-plan on Opus 5");
    expect(copy.detail).toContain("without your answers");
  });

  it("describes the approval gate when approvePlan is on", () => {
    const copy = planningLaunchCopy("claude-opus-5", models, true);
    expect(copy.actionLabel).toBe("Start auto-plan on Opus 5");
    expect(copy.detail).toContain("pauses for your approval");
    expect(copy.detail).not.toContain("without your answers");
  });
});

describe("defaultConversationModel", () => {
  it("returns the first model id", () => {
    expect(
      defaultConversationModel([
        { id: "composer-2.5", displayName: "Composer 2.5" },
      ]),
    ).toBe("composer-2.5");
  });

  it("returns undefined when the list is empty", () => {
    expect(defaultConversationModel([])).toBeUndefined();
  });
});
