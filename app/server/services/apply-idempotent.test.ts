import { describe, expect, it } from "vitest";
import {
  baseDoc,
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
});
