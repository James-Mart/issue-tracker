import { beforeEach, describe, expect, it } from "vitest";
import { runIssueCli } from "./cli-program.js";
import { env, nextAt, useCliTestFixtures, writeIssue } from "./cli.test-helpers.js";

useCliTestFixtures();

describe("work queue CLI", () => {
  beforeEach(() => {
    writeIssue("p", {
      kind: "project",
      title: "Proj",
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    writeIssue("e", {
      kind: "epic",
      title: "Epic",
      partOf: "p",
      order: 1,
      workQueuedAt: "2026-01-01T00:00:00.000Z",
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    writeIssue("s", {
      kind: "story",
      title: "Story",
      partOf: "p",
      order: 2,
      merged: false,
      workQueuedAt: "2026-01-02T00:00:00.000Z",
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
  });

  it("reads and sets maxImplementingRuns, refusing values below 1", async () => {
    expect(
      (await runIssueCli(["project", "get", "p", "maxImplementingRuns"], { env: env() }))
        .stdout,
    ).toBe("1\n");
    expect(
      (await runIssueCli(["project", "set", "p", "maxImplementingRuns", "3"], { env: env() }))
        .status,
    ).toBe(0);
    expect(
      (await runIssueCli(["project", "get", "p", "maxImplementingRuns"], { env: env() }))
        .stdout,
    ).toBe("3\n");
    const refused = await runIssueCli(
      ["project", "set", "p", "maxImplementingRuns", "0"],
      { env: env() },
    );
    expect(refused.status).not.toBe(0);
    expect(
      (await runIssueCli(["project", "get", "p", "maxImplementingRuns"], { env: env() }))
        .stdout,
    ).toBe("3\n");
  });

  it("reads workQueuedAt and clears it", async () => {
    expect(
      (await runIssueCli(["epic", "get", "e", "workQueuedAt"], { env: env() })).stdout,
    ).toBe("2026-01-01T00:00:00.000Z\n");
    const stamped = await runIssueCli(
      ["epic", "set", "e", "workQueuedAt", "2026-02-01T00:00:00.000Z"],
      { env: env() },
    );
    expect(stamped.status).not.toBe(0);
    const cleared = await runIssueCli(
      ["epic", "set", "e", "workQueuedAt", "--clear"],
      { env: env() },
    );
    expect(cleared.stderr).toBe("");
    expect(cleared.status).toBe(0);
    expect(
      (await runIssueCli(["epic", "get", "e", "workQueuedAt"], { env: env() })).stdout,
    ).toBe("");
    expect(
      (await runIssueCli(["story", "set", "s", "workQueuedAt", "--clear"], { env: env() }))
        .status,
    ).toBe(0);
    expect(
      (await runIssueCli(["story", "get", "s", "workQueuedAt"], { env: env() })).stdout,
    ).toBe("");
  });
});
