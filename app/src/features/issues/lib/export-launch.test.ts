import { describe, expect, it } from "vitest";
import { skillPath } from "@/lib/plugin-paths";
import { exportSessionMessage, exportSessionTitle } from "./export-launch";

describe("exportSessionTitle", () => {
  it("templates the title from the root title", () => {
    expect(exportSessionTitle("Ship it")).toBe("Export Ship it");
  });
});

describe("exportSessionMessage", () => {
  it("tells the coordinator to read the rewrite skill for the root", () => {
    expect(exportSessionMessage("ship-it")).toBe(
      `Rewrite ship-it as GitHub export drafts using the issue-tracker-github-export skill. **Read** ${skillPath("issue-tracker-github-export")} and follow it.`,
    );
  });
});
