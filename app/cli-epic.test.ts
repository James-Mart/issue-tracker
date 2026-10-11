import { beforeEach, describe, expect, it } from "vitest";
import { runIssueCli } from "./cli-program.js";
import {
  blockedByOf,
  env,
  nextAt,
  useCliTestFixtures,
  writeIssue,
} from "./cli.test-helpers.js";

useCliTestFixtures();

describe("epic blockedBy set", () => {
  beforeEach(() => {
    writeIssue("p", { kind: "project", title: "Proj", createdAt: nextAt(), updatedAt: nextAt() });
    for (const [order, id] of ["e", "blocker", "other"].entries()) {
      writeIssue(id, {
        kind: "epic",
        title: id,
        partOf: "p",
        order,
        blockedBy: [],
        createdAt: nextAt(),
        updatedAt: nextAt(),
      });
    }
  });

  it("replaces and incrementally edits blockedBy", async () => {
    expect(
      (await runIssueCli(["epic", "set", "e", "blockedBy", '["blocker"]'], { env: env() })).status,
    ).toBe(0);
    expect(blockedByOf("e")).toEqual(["blocker"]);
    expect((await runIssueCli(["epic", "get", "e", "blockedBy"], { env: env() })).stdout).toBe('["blocker"]\n');

    expect((await runIssueCli(["epic", "set", "e", "blockedBy", "--add", "other"], { env: env() })).status).toBe(0);
    expect(blockedByOf("e").sort()).toEqual(["blocker", "other"]);

    // --add is idempotent for ids already present.
    expect((await runIssueCli(["epic", "set", "e", "blockedBy", "--add", "blocker", "other"], { env: env() })).status).toBe(
      0,
    );
    expect(blockedByOf("e").sort()).toEqual(["blocker", "other"]);

    expect((await runIssueCli(["epic", "set", "e", "blockedBy", "--remove", "blocker"], { env: env() })).status).toBe(0);
    expect(blockedByOf("e")).toEqual(["other"]);

    expect((await runIssueCli(["epic", "set", "e", "blockedBy", "--clear"], { env: env() })).status).toBe(0);
    expect(blockedByOf("e")).toEqual([]);
    expect((await runIssueCli(["epic", "get", "e", "blockedBy"], { env: env() })).stdout).toBe("[]\n");
  });
});
