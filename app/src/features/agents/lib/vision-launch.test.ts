import { describe, expect, it } from "vitest";
import { visionSessionMessage } from "./vision-launch";

describe("visionSessionMessage", () => {
  it("names the Project id and issue-tracker-vision-docs skill", () => {
    expect(visionSessionMessage("issue-tracker")).toBe(
      "Refine vision for issue-tracker in the issue tracker using the issue-tracker-vision-docs skill.",
    );
  });
});
