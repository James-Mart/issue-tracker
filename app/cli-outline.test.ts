import { writeFileSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it } from "vitest";
import { runIssueCli } from "./cli-program.js";
import { dir, env, nextAt, useCliTestFixtures, writeIssue } from "./cli.test-helpers.js";

useCliTestFixtures();

describe("outline versions", () => {
  beforeEach(() => {
    writeIssue("p", {
      kind: "project",
      title: "Proj",
      trunk: "main",
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
  });

  it("keeps the previous body when a new one is saved", async () => {
    const first = join(dir, "v1.md");
    const second = join(dir, "v2.md");
    writeFileSync(first, "alpha\n");
    writeFileSync(second, "beta\n");

    const created = await runIssueCli(
      [
        "outline",
        "add",
        "--in",
        "p",
        "--title",
        "Catalog",
        "--description-file",
        first,
      ],
      { env: env() },
    );
    expect(created.status).toBe(0);
    const id = created.stdout.trim();

    expect(
      (
        await runIssueCli(
          ["outline", "set", id, "description", "--file", second],
          { env: env() },
        )
      ).status,
    ).toBe(0);
    expect(
      (await runIssueCli(["outline", "get", id, "version"], { env: env() })).stdout,
    ).toBe("2\n");

    const latest = await runIssueCli(["outline", "view", id], { env: env() });
    expect(latest.status).toBe(0);
    expect(latest.stdout).toContain("version: 2");
    expect(latest.stdout).toContain("beta\n");

    const older = await runIssueCli(["outline", "view", id, "--version", "1"], {
      env: env(),
    });
    expect(older.status).toBe(0);
    expect(older.stdout).toContain("version: 1");
    expect(older.stdout).toContain("alpha\n");
    expect(older.stdout).not.toContain("beta");

    const diff = await runIssueCli(["outline", "diff", id, "1", "2"], { env: env() });
    expect(diff.status).toBe(0);
    expect(diff.stdout).toContain("-alpha");
    expect(diff.stdout).toContain("+beta");
  });
});
