import { describe, expect, it } from "vitest";
import {
  exportDraftBody,
  exportDraftIssueId,
  exportDraftKindLabel,
  exportDraftTitle,
  exportRunStripLabel,
  orderExportDraftNames,
  type ExportDraftOrderIssue,
} from "./export-workbench";

const epic: ExportDraftOrderIssue = {
  id: "auth",
  kind: "epic",
  order: 0,
  partOf: "issue-tracker",
};

const timeout: ExportDraftOrderIssue = {
  id: "timeout",
  kind: "story",
  order: 1,
  partOf: "auth",
};

const mfa: ExportDraftOrderIssue = {
  id: "mfa",
  kind: "story",
  order: 0,
  partOf: "auth",
  stackedOn: "timeout",
};

describe("export draft files", () => {
  it("reads the issue id, title, and body from a reserved draft", () => {
    const content = "---\ntitle: Session timeout policy\n---\n## Summary\n\nIdle.\n";
    expect(exportDraftIssueId("github-export-timeout.md")).toBe("timeout");
    expect(exportDraftTitle(content)).toBe("Session timeout policy");
    expect(exportDraftBody(content)).toBe("## Summary\n\nIdle.\n");
    expect(exportDraftTitle("no frontmatter\n")).toBeNull();
    expect(exportDraftKindLabel("epic")).toBe("Epic");
    expect(exportDraftKindLabel("story")).toBe("Story");
    expect(exportDraftKindLabel("task")).toBeNull();
  });

  it("lists an epic then its stories in tracker order", () => {
    expect(
      orderExportDraftNames(epic, [mfa, epic, timeout], [
        "github-export-mfa.md",
        "notes.md",
        "github-export-auth.md",
        "github-export-stray.md",
        "github-export-timeout.md",
      ]),
    ).toEqual([
      "github-export-auth.md",
      "github-export-timeout.md",
      "github-export-mfa.md",
      "github-export-stray.md",
    ]);
  });

  it("keeps a project-level story as the only ordered draft", () => {
    expect(
      orderExportDraftNames(
        { id: "solo", kind: "story" },
        [{ id: "solo", kind: "story", order: 0, partOf: "issue-tracker" }],
        ["github-export-extra.md", "github-export-solo.md"],
      ),
    ).toEqual(["github-export-solo.md", "github-export-extra.md"]);
  });
});

describe("export run strip label", () => {
  it("names running, pending, failed, and complete", () => {
    expect(
      exportRunStripLabel({
        activeRun: true,
        outcomePending: false,
        latestFailed: false,
        draftCount: 2,
      }),
    ).toBe("Rewrite running");
    expect(
      exportRunStripLabel({
        activeRun: false,
        outcomePending: true,
        latestFailed: false,
        draftCount: 2,
      }),
    ).toBe("Export session");
    expect(
      exportRunStripLabel({
        activeRun: false,
        outcomePending: false,
        latestFailed: true,
        draftCount: 2,
      }),
    ).toBe("Export failed");
    expect(
      exportRunStripLabel({
        activeRun: false,
        outcomePending: false,
        latestFailed: false,
        draftCount: 1,
      }),
    ).toBe("Export complete — 1 draft attached");
  });
});
