import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, vi } from "vitest";
import type { EpicChildNode, ProjectApplyDoc } from "./apply-schema.js";

export const AT = "2026-07-09T14:00:00.000Z";

export let dir: string;

export function writeIssue(id: string, body: Record<string, unknown>): void {
  mkdirSync(join(dir, id), { recursive: true });
  writeFileSync(join(dir, id, "issue.json"), JSON.stringify({ id, ...body }));
}

export function readIssue(id: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, id, "issue.json"), "utf8"));
}

// A stable, order-independent snapshot of every file the service writes, used to
// assert that a rejected apply leaves the on-disk state byte-for-byte unchanged.
export function snapshot(): string {
  if (!existsSync(dir)) return "{}";
  const tree: Record<string, Record<string, string>> = {};
  for (const id of readdirSync(dir).sort()) {
    const idDir = join(dir, id);
    // Skip migration marker files (and any other non-issue entries).
    if (!statSync(idDir).isDirectory()) continue;
    const files: Record<string, string> = {};
    for (const file of ["issue.json", "description.md", "comments.jsonl"]) {
      const path = join(idDir, file);
      if (existsSync(path)) files[file] = readFileSync(path, "utf8");
    }
    tree[id] = files;
  }
  return JSON.stringify(tree);
}

export async function loadService() {
  const apply = (await import("./apply.js")).apply;
  const issues = await import("./issues.js");
  return { apply, ...issues };
}

export function epicChildren(doc: ProjectApplyDoc): EpicChildNode[] {
  return (doc.project.children ?? []).filter(
    (child): child is EpicChildNode => child.kind === "epic",
  );
}

// A representative tree: project > two epics. `epic-a` has two root branches,
// one carrying a commit and a stacked child; the stacked edge (b1s -> b1) lives
// inside the epic. Epic-level `blockedBy` covers the forward-reference case:
// `epic-a` blocks on `epic-b`, which the doc declares *after* it in the same
// project, and the two are distinct so the dependency graph stays acyclic.
export function baseDoc(): ProjectApplyDoc {
  return {
    project: {
      id: "proj",
      title: "Project",
      description: "Project overview\n",
      children: [
        {
          kind: "epic",
          id: "epic-a",
          title: "Epic A",
          blockedBy: ["epic-b"],
          children: [
            {
              kind: "story",
              id: "b1",
              title: "Branch one",
              children: [
                { kind: "task", id: "c1", title: "Commit one" },
                { kind: "story", id: "b1s", title: "Stacked on one" },
              ],
            },
            { kind: "story", id: "b2", title: "Branch two" },
          ],
        },
        {
          kind: "epic",
          id: "epic-b",
          title: "Epic B",
        },
      ],
    },
  };
}

export function useApplyTestFixtures(): void {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "issue-tracker-apply-"));
    vi.resetModules();
    vi.stubEnv("ISSUES_DIR", dir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });
}
