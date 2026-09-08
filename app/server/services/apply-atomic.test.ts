import { existsSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import type { ApplyDoc } from "./apply-schema.js";
import {
  AT,
  baseDoc,
  dir,
  loadService,
  snapshot,
  useApplyTestFixtures,
  writeIssue,
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

  it("rejects a create colliding with an id outside the declared project", async () => {
    // An orphan branch owned by a different project.
    writeIssue("p2", { kind: "project", title: "P2", createdAt: AT, updatedAt: AT });
    writeIssue("e2", { kind: "epic", title: "E2", partOf: "p2", createdAt: AT, updatedAt: AT });
    writeIssue("shared", {
      kind: "story",
      title: "Shared",
      partOf: "e2",
      createdAt: AT,
      updatedAt: AT,
    });

    const { apply, ensureMigrations } = await loadService();
    // One-time migrations run at the start of apply; settle them before the
    // "no writes on reject" snapshot so migration isn't mistaken for a
    // partial apply write.
    ensureMigrations();
    const before = snapshot();

    const doc: ApplyDoc = {
      project: {
        id: "p1",
        title: "P1",
        children: [
          {
            kind: "epic",
            id: "e1",
            title: "E1",
            children: [{ kind: "story", id: "shared", title: "Collision" }],
          },
        ],
      },
    };
    await expect(apply(doc)).rejects.toThrow(
      /already exists outside the target project/,
    );

    // The doc's project was never created, and the orphan is untouched.
    expect(existsSync(join(dir, "p1"))).toBe(false);
    expect(existsSync(join(dir, "e1"))).toBe(false);
    expect(snapshot()).toBe(before);
  });
});
