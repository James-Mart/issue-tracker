import { describe, expect, it } from "vitest";
import { loadService, readIssue, useApplyTestFixtures } from "./apply.test-fixtures.js";

useApplyTestFixtures();

describe("apply — Idea approvePlan", () => {
  it("preserves approvePlan when re-applying the Idea doc", async () => {
    const { apply, update } = await loadService();
    await apply({
      project: {
        id: "p1",
        title: "P1",
        children: [{ kind: "idea", id: "i1", title: "Capture" }],
      },
    });
    await update("i1", { approvePlan: true });
    expect(readIssue("i1").approvePlan).toBe(true);

    const summary = await apply({
      project: {
        id: "p1",
        title: "P1",
        children: [{ kind: "idea", id: "i1", title: "Capture renamed" }],
      },
    });
    expect(summary.updated).toContain("i1");
    expect(readIssue("i1")).toMatchObject({
      title: "Capture renamed",
      approvePlan: true,
    });
  });
});

describe("apply — Idea appendTo", () => {
  it("preserves appendTo when re-applying the Idea doc", async () => {
    const { apply, update } = await loadService();
    await apply({
      project: {
        id: "p1",
        title: "P1",
        children: [
          { kind: "story", id: "s1", title: "Target" },
          { kind: "idea", id: "i1", title: "Capture" },
        ],
      },
    });
    await update("i1", { appendTo: "s1" });
    expect(readIssue("i1").appendTo).toBe("s1");

    const summary = await apply({
      project: {
        id: "p1",
        title: "P1",
        children: [
          { kind: "story", id: "s1", title: "Target" },
          { kind: "idea", id: "i1", title: "Capture renamed" },
        ],
      },
    });
    expect(summary.updated).toContain("i1");
    expect(readIssue("i1")).toMatchObject({
      title: "Capture renamed",
      appendTo: "s1",
    });
  });
});
