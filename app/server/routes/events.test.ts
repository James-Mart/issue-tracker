import { describe, expect, it } from "vitest";
import { issueIdFromPath, scopeFromPath } from "./events.js";

describe("issueIdFromPath", () => {
  it("derives the id from a file inside an issue dir", () => {
    expect(issueIdFromPath("/issues", "/issues/add-auth/issue.json")).toBe(
      "add-auth",
    );
  });

  it("derives the id from any nested file", () => {
    expect(issueIdFromPath("/issues", "/issues/add-auth/chat.jsonl")).toBe(
      "add-auth",
    );
  });

  it("derives the id from the issue dir itself", () => {
    expect(issueIdFromPath("/issues", "/issues/add-auth")).toBe("add-auth");
  });

  it("returns null for the base dir and outside paths", () => {
    expect(issueIdFromPath("/issues", "/issues")).toBeNull();
    expect(issueIdFromPath("/issues", "/other/thing")).toBeNull();
  });
});

describe("scopeFromPath", () => {
  it("classifies chat.jsonl writes as chat scope", () => {
    expect(scopeFromPath("/issues/add-auth/chat.jsonl")).toBe("chat");
  });

  it("classifies attachment dir and files as attachments scope", () => {
    expect(scopeFromPath("/issues/add-auth/attachments")).toBe("attachments");
    expect(scopeFromPath("/issues/add-auth/attachments/mock.tsx")).toBe(
      "attachments",
    );
  });

  it("classifies other files as issue scope", () => {
    expect(scopeFromPath("/issues/add-auth/issue.json")).toBe("issue");
    expect(scopeFromPath("/issues/add-auth/description.md")).toBe("issue");
    expect(scopeFromPath("/issues/add-auth")).toBe("issue");
  });
});
