import { describe, expect, it } from "vitest";
import { parseIssue } from "./schemas";

const idea = {
  id: "capture-flow",
  kind: "idea" as const,
  title: "Capture flow",
  partOf: "platform",
  createdAt: "2026-07-09T14:00:00.000Z",
  updatedAt: "2026-07-09T14:00:00.000Z",
};

describe("parseIssue — Idea gate fields", () => {
  it("parses executionGate and codeApprovalRequired", () => {
    const result = parseIssue({
      ...idea,
      stakeholder: "composer-2.5",
      executionGate: true,
      codeApprovalRequired: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.issue.kind === "idea") {
      expect(result.issue.executionGate).toBe(true);
      expect(result.issue.codeApprovalRequired).toBe(true);
    }
  });
});
