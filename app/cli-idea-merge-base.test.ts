import { beforeEach, describe, expect, it } from "vitest";
import { runIssueCli } from "./cli-program.js";
import { env, issueJsonField, nextAt, useCliTestFixtures, writeIssue } from "./cli.test-helpers.js";

useCliTestFixtures();

describe("idea mergeBase", () => {
  beforeEach(() => {
    writeIssue("p", {
      kind: "project",
      title: "Proj",
      trunk: "main",
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    writeIssue("capture", {
      kind: "idea",
      title: "Capture",
      partOf: "p",
      order: 0,
      archived: false,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
  });

  it("stays unset on create, then sets, reads, and clears", async () => {
    const created = await runIssueCli(
      ["idea", "add", "Fresh", "--part-of", "p"],
      { env: env() },
    );
    expect(created.status).toBe(0);
    const createdId = created.stdout.trim();
    expect(issueJsonField(createdId, "mergeBase")).toBeUndefined();
    expect(
      (await runIssueCli(["idea", "get", createdId, "mergeBase"], { env: env() })).stdout,
    ).toBe("");

    expect(
      (await runIssueCli(["idea", "get", "capture", "mergeBase"], { env: env() })).stdout,
    ).toBe("");

    expect(
      (await runIssueCli(["idea", "set", "capture", "mergeBase", "release"], { env: env() }))
        .status,
    ).toBe(0);
    expect(issueJsonField("capture", "mergeBase")).toBe("release");
    expect(
      (await runIssueCli(["idea", "get", "capture", "mergeBase"], { env: env() })).stdout,
    ).toBe("release\n");

    const view = await runIssueCli(["idea", "view", "capture"], { env: env() });
    expect(view.stdout).toContain("mergeBase: release");

    expect(
      (await runIssueCli(["idea", "set", "capture", "mergeBase", "--clear"], { env: env() }))
        .status,
    ).toBe(0);
    expect(issueJsonField("capture", "mergeBase")).toBeUndefined();
    expect(
      (await runIssueCli(["idea", "get", "capture", "mergeBase"], { env: env() })).stdout,
    ).toBe("");

    const blank = await runIssueCli(["idea", "set", "capture", "mergeBase", ""], {
      env: env(),
    });
    expect(blank.status).not.toBe(0);
    expect(issueJsonField("capture", "mergeBase")).toBeUndefined();
  });
});
