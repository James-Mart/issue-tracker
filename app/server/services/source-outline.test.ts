import { existsSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  AT,
  baseDoc,
  dir,
  epicChildren,
  loadService,
  readIssue,
  useApplyTestFixtures,
  writeIssue,
} from "./apply.test-fixtures.js";

useApplyTestFixtures();

const stamp = { outline: "outline-a", version: 1 };

describe("sourceOutline", () => {
  it("reads an older unmerged stamp back and reports behind", async () => {
    const { apply } = await loadService();
    const { kindGetValue, kindSet } = await import("../../cli-kind.js");
    await apply(baseDoc());
    writeIssue("outline-a", {
      kind: "outline",
      title: "Outline",
      partOf: "proj",
      bodyVersion: 2,
      archived: false,
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });

    await kindSet("epic", "epic-a", "sourceOutline", JSON.stringify(stamp), {});
    await kindSet("story", "b2", "sourceOutline", JSON.stringify(stamp), {});
    await kindSet("task", "c1", "sourceOutline", JSON.stringify(stamp), {});

    expect(JSON.parse((await kindGetValue("epic", "epic-a", "sourceOutline"))!)).toEqual(stamp);
    expect(JSON.parse((await kindGetValue("story", "b2", "sourceOutline"))!)).toEqual(stamp);
    expect(JSON.parse((await kindGetValue("task", "c1", "sourceOutline"))!)).toEqual(stamp);
    expect(await kindGetValue("epic", "epic-a", "behind")).toBe("true");
    expect(await kindGetValue("story", "b2", "behind")).toBe("true");
    expect(await kindGetValue("task", "c1", "behind")).toBe("true");
  });

  it("keeps the stamp when the plan is re-applied", async () => {
    const { apply } = await loadService();
    const { kindSet } = await import("../../cli-kind.js");
    await apply(baseDoc());
    writeIssue("outline-a", {
      kind: "outline",
      title: "Outline",
      partOf: "proj",
      bodyVersion: 2,
      archived: false,
      order: 0,
      createdAt: AT,
      updatedAt: AT,
    });
    await kindSet("epic", "epic-a", "sourceOutline", JSON.stringify(stamp), {});
    await kindSet("story", "b2", "sourceOutline", JSON.stringify(stamp), {});
    await kindSet("task", "c1", "sourceOutline", JSON.stringify(stamp), {});

    const doc = baseDoc();
    epicChildren(doc)[0].title = "Epic A renamed";
    epicChildren(doc)[0].children![1].title = "Branch two renamed";
    epicChildren(doc)[0].children![0].children![0].title = "Commit one renamed";
    await apply(doc);

    expect(readIssue("epic-a").sourceOutline).toEqual(stamp);
    expect(readIssue("b2").sourceOutline).toEqual(stamp);
    expect(readIssue("c1").sourceOutline).toEqual(stamp);
    expect(existsSync(join(dir, "outline-a", "issue.json"))).toBe(true);
  });
});
