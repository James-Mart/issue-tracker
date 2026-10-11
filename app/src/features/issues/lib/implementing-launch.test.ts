import { describe, expect, it } from "vitest";
import { skillPath } from "@/lib/plugin-paths";
import { implementingSessionMessage } from "@server/services/implementing-launch";

describe("implementingSessionMessage", () => {
  it("names the work-root id and issue-tracker-work skill", () => {
    expect(implementingSessionMessage("ship-it")).toBe(
      `Work ship-it in the issue tracker using the issue-tracker-work skill. Read ${skillPath("issue-tracker-work")} and follow it.`,
    );
  });
});
