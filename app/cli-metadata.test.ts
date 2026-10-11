import { beforeEach, describe, expect, it } from "vitest";
import { runIssueCli } from "./cli-program.js";
import {
  env,
  issueJsonField,
  nextAt,
  useCliTestFixtures,
  writeIssue,
} from "./cli.test-helpers.js";

useCliTestFixtures();

describe("project labels catalog and assignments", () => {
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
      blockedBy: [],
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
    writeIssue("a", {
      kind: "story",
      title: "Story A",
      partOf: "e",
      merged: false,
      createdAt: nextAt(),
      updatedAt: nextAt(),
    });
  });

  function catalogOf(): Array<{ id: string; color: string; description?: string }> {
    return issueJsonField("p", "labels") ?? [];
  }

  function labelsOf(id: string): string[] {
    return issueJsonField(id, "labels") ?? [];
  }

  async function seedCatalog(
    ...labels: Array<{ id: string; color: string; description?: string }>
  ): Promise<void> {
    for (const label of labels) {
      expect(
        (await runIssueCli(["project", "set", "p", "labels", "--add", JSON.stringify(label)], { env: env() }))
          .status,
      ).toBe(0);
    }
  }

  it("cascades catalog remove and rename onto assignments", async () => {
    await seedCatalog(
      { id: "bug", color: "#ff0000" },
      { id: "feat", color: "#00ff00" },
    );
    expect((await runIssueCli(["epic", "set", "e", "labels", "--add", "bug", "feat"], { env: env() })).status).toBe(
      0,
    );
    expect((await runIssueCli(["story", "set", "a", "labels", "--add", "bug"], { env: env() })).status).toBe(0);

    expect((await runIssueCli(["project", "set", "p", "labels", "--remove", "bug"], { env: env() })).status).toBe(
      0,
    );
    expect(labelsOf("e")).toEqual(["feat"]);
    expect(labelsOf("a")).toEqual([]);

    expect((await runIssueCli(["epic", "set", "e", "labels", "--add", "feat"], { env: env() })).status).toBe(0);
    expect(
      (await runIssueCli(["project", "set", "p", "labels", "--rename", "feat", "feature"], { env: env() })).status,
    ).toBe(0);
    expect(labelsOf("e")).toEqual(["feature"]);
    expect(catalogOf().map((l) => l.id)).toEqual(["feature"]);
  });
});
