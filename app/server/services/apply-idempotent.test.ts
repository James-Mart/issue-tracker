import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  baseDoc,
  dir,
  loadService,
  readIssue,
  snapshot,
  useApplyTestFixtures,
} from "./apply.test-fixtures.js";

useApplyTestFixtures();

describe("apply — idempotent re-apply", () => {
  it("is a no-op and does not churn updatedAt", async () => {
    const { apply } = await loadService();
    await apply(baseDoc());

    const before = new Map(
      ["proj", "epic-a", "b1", "b1s", "b2", "c1"].map((id) => [
        id,
        readIssue(id).updatedAt as string,
      ]),
    );
    const beforeBytes = snapshot();

    const summary = await apply(baseDoc());
    expect(summary).toEqual({ created: [], updated: [], deleted: [] });

    for (const [id, updatedAt] of before) {
      expect(readIssue(id).updatedAt).toBe(updatedAt);
    }
    // Beyond the updatedAt guard: a no-op re-apply must not rewrite any file,
    // including description.md, so the on-disk bytes are identical.
    expect(snapshot()).toBe(beforeBytes);
  });

  it("tidies a stale on-disk key the schema no longer recognizes", async () => {
    const { apply } = await loadService();
    await apply(baseDoc());

    // Simulate pre-migration drift: a Branch with a `blockedBy` key that the
    // current schema strips on read. The parsed issue is unchanged, so without
    // stale-key detection a re-apply would treat this file as a no-op.
    const path = join(dir, "b2", "issue.json");
    const raw = JSON.parse(readFileSync(path, "utf8"));
    const updatedAt = raw.updatedAt as string;
    writeFileSync(path, JSON.stringify({ ...raw, blockedBy: ["b1"] }, null, 2));

    const otherBytes = snapshot();

    const summary = await apply(baseDoc());
    expect(summary.updated).toEqual(["b2"]);
    expect(summary.created).toEqual([]);
    expect(summary.deleted).toEqual([]);

    // The stale key is gone and every other on-disk field is preserved,
    // including `updatedAt` — tidying is not a semantic change.
    const after = readIssue("b2");
    expect("blockedBy" in after).toBe(false);
    expect(after.updatedAt).toBe(updatedAt);

    // Only b2 was rewritten; no sibling file changed.
    const before = JSON.parse(otherBytes) as Record<string, Record<string, string>>;
    const now = JSON.parse(snapshot()) as Record<string, Record<string, string>>;
    for (const id of Object.keys(before)) {
      if (id === "b2") continue;
      expect(now[id]).toEqual(before[id]);
    }
  });
});
