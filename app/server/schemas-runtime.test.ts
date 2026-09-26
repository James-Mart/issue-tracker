import { describe, expect, it } from "vitest";
import { parseIssue } from "./schemas";

const project = {
  id: "platform",
  kind: "project",
  title: "Platform",
  createdAt: "2026-07-09T14:00:00.000Z",
  updatedAt: "2026-07-09T14:00:00.000Z",
};

describe("parseIssue — Project runtime", () => {
  it("parses optional runtime phases", () => {
    const result = parseIssue({
      ...project,
      runtime: {
        build: "npm run build",
        baseUrl: "http://localhost:3000",
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok && result.issue.kind === "project") {
      expect(result.issue.runtime).toEqual({
        build: "npm run build",
        baseUrl: "http://localhost:3000",
      });
    }
  });

  it("rejects unknown runtime keys and empty phase strings", () => {
    expect(
      parseIssue({
        ...project,
        runtime: {
          build: "npm run build",
          extra: "noop",
        },
      }).ok,
    ).toBe(false);
    expect(
      parseIssue({
        ...project,
        runtime: { build: "" },
      }).ok,
    ).toBe(false);
  });
});
