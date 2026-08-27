import { describe, expect, it } from "vitest";
import { attachmentEmbedMarkdown, parseArgs } from "./mockup-promote.js";

describe("attachmentEmbedMarkdown", () => {
  it("matches the transcript attachment image markdown form", () => {
    const issueId = "demo-issue";
    const name = "empty.png";
    expect(attachmentEmbedMarkdown(issueId, name)).toBe(
      `![${name}](/api/issues/${issueId}/attachments/${name})`,
    );
  });
});

describe("parseArgs", () => {
  it("parses capturing flags", () => {
    expect(
      parseArgs([
        "--direction",
        "direction-a",
        "--issue",
        "idea-1",
        "--mode",
        "candidate",
        "--conversation",
        "my-chat",
      ]),
    ).toEqual({
      mode: "candidate",
      directionId: "direction-a",
      issueId: "idea-1",
      conversationId: "my-chat",
      fromIssueId: undefined,
    });
  });

  it("parses copy flags", () => {
    expect(
      parseArgs([
        "--direction",
        "direction-a",
        "--issue",
        "idea-2",
        "--mode",
        "copy",
        "--from-issue",
        "idea-1",
      ]),
    ).toEqual({
      mode: "copy",
      directionId: "direction-a",
      issueId: "idea-2",
      conversationId: undefined,
      fromIssueId: "idea-1",
    });
  });

  it("rejects an unknown mode", () => {
    expect(() =>
      parseArgs([
        "--direction",
        "direction-a",
        "--issue",
        "idea-1",
        "--mode",
        "preview",
      ]),
    ).toThrow(/candidate, chosen, or copy/);
  });

  it("requires direction, issue, and mode", () => {
    expect(() => parseArgs(["--issue", "idea-1", "--mode", "copy"])).toThrow(
      /--direction is required/,
    );
    expect(() =>
      parseArgs(["--direction", "direction-a", "--mode", "copy"]),
    ).toThrow(/--issue is required/);
    expect(() =>
      parseArgs(["--direction", "direction-a", "--issue", "idea-1"]),
    ).toThrow(/--mode is required/);
  });
});
