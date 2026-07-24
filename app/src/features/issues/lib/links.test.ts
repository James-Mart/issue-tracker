import { describe, expect, it } from "vitest";
import { issueChatPath, issuePath, parseIssueLink } from "./links";

describe("parseIssueLink", () => {
  it("extracts ids from issue: hrefs", () => {
    expect(parseIssueLink("issue:attachments-core")).toBe("attachments-core");
    expect(parseIssueLink("https://example.com")).toBeNull();
    expect(parseIssueLink("foo.tsx")).toBeNull();
    expect(parseIssueLink(undefined)).toBeNull();
  });
});

describe("issueChatPath", () => {
  it("is the detail route (absent chat means expanded)", () => {
    expect(issueChatPath("proj", "story-1")).toBe(
      "/projects/proj/issues/story-1",
    );
    expect(issueChatPath("proj", "story-1")).toBe(issuePath("proj", "story-1"));
  });
});
