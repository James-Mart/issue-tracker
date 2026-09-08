import { describe, expect, it } from "vitest";
import type { ApplyDoc } from "./apply-schema.js";
import {
  epicChildren,
  loadService,
  readIssue,
  snapshot,
  useApplyTestFixtures,
} from "./apply.test-fixtures.js";

useApplyTestFixtures();

describe("apply — sibling order", () => {
  it("infers order from doc position and re-authoring reorders commits", async () => {
    const { apply } = await loadService();
    const doc: ApplyDoc = {
      project: {
        id: "ord",
        title: "Order",
        children: [
          {
            kind: "epic",
            id: "e",
            title: "E",
            children: [
              {
                kind: "story",
                id: "b",
                title: "B",
                children: [
                  { kind: "task", id: "first", title: "First" },
                  { kind: "task", id: "second", title: "Second" },
                ],
              },
            ],
          },
        ],
      },
    };
    await apply(doc);
    expect(readIssue("first").order).toBe(0);
    expect(readIssue("second").order).toBe(1);

    epicChildren(doc)[0].children![0].children = [
      { kind: "task", id: "second", title: "Second" },
      { kind: "task", id: "first", title: "First" },
    ];
    await apply(doc);
    expect(readIssue("first").order).toBe(1);
    expect(readIssue("second").order).toBe(0);
  });

  it("rejects a doc with explicit order and writes nothing", async () => {
    await loadService();
    const before = snapshot();
    const { parseApplyDoc } = await import("./apply-schema.js");
    const { parse } = await import("yaml");
    const parsed = parseApplyDoc(
      parse(`
project:
  id: bad
  title: Bad
  children:
    - kind: epic
      id: e
      title: E
      children:
        - kind: story
          id: b
          title: B
          children:
            - kind: task
              id: c1
              title: C1
              order: 0
            - kind: task
              id: c2
              title: C2
              order: 0
`),
    );
    expect(parsed.ok).toBe(false);
    expect(snapshot()).toBe(before);
  });
});
