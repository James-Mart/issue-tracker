import { describe, expect, it } from "vitest";
import { runIssueCli } from "./cli-program.js";
import { env, nextAt, useCliTestFixtures, writeIssue } from "./cli.test-helpers.js";

useCliTestFixtures();

async function get(id: string, field: string) {
  return runIssueCli(["idea", "get", id, field], { env: env() });
}

describe("idea plan settings", () => {
  it("prints the defaults on a new Idea", async () => {
    writeIssue("p", {
      kind: "project",
      title: "Proj",
      trunk: "main",
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    const created = await runIssueCli(["idea", "add", "Fresh", "--part-of", "p"], {
      env: env(),
    });
    expect(created.status).toBe(0);
    const id = created.stdout.trim();
    expect((await get(id, "decompositionGate")).stdout).toBe("false\n");
    expect((await get(id, "executionGate")).stdout).toBe("auto\n");
    expect((await get(id, "outOfBand")).stdout).toBe("false\n");
    expect((await get(id, "mergePolicy")).stdout).toBe("");
  });
});
