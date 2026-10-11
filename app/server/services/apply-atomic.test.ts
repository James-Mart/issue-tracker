import { existsSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  baseDoc,
  dir,
  loadService,
  snapshot,
  useApplyTestFixtures,
} from "./apply.test-fixtures.js";

useApplyTestFixtures();

describe("apply — atomic rejection", () => {
  it("makes no partial writes when the prospective graph is invalid", async () => {
    const { apply } = await loadService();
    await apply(baseDoc());

    const before = snapshot();

    // A new epic that blocks on a non-existent epic. Valid shape, but the whole
    // prospective set fails integrity, so nothing may be written.
    const doc = baseDoc();
    doc.project.children!.push({
      kind: "epic",
      id: "epic-c",
      title: "Epic C",
      blockedBy: ["ghost"],
      children: [{ kind: "story", id: "b3", title: "Branch three" }],
    });

    await expect(apply(doc)).rejects.toThrow(/unknown issue "ghost"/);

    expect(existsSync(join(dir, "epic-c"))).toBe(false);
    expect(existsSync(join(dir, "b3"))).toBe(false);
    expect(snapshot()).toBe(before);
  });
});
