import { describe, expect, it } from "vitest";
import { issueChannelPath, issuePath, parseIssueLink } from "./links";

describe("parseIssueLink", () => {
  it("extracts ids from issue: hrefs", () => {
    expect(parseIssueLink("issue:attachments-core")).toBe("attachments-core");
    expect(parseIssueLink("https://example.com")).toBeNull();
    expect(parseIssueLink("foo.tsx")).toBeNull();
    expect(parseIssueLink(undefined)).toBeNull();
  });
});

describe("issuePath", () => {
  it("builds the detail route", () => {
    expect(issuePath("proj", "story-1")).toBe("/projects/proj/issues/story-1");
  });
});

describe("issueChannelPath", () => {
  it("includes the tab query for a channel", () => {
    expect(issueChannelPath("proj", "ship-it", "implementing")).toBe(
      "/projects/proj/issues/ship-it?tab=implementing",
    );
  });
});
