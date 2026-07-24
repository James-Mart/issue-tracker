import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { issuesDir } from "../config.js";
import { parseIssue, type Issue } from "../schemas.js";

/** One parseable on-disk issue directory (skips missing/invalid JSON). */
export interface OnDiskIssue {
  /** Directory name under `issuesDir`. */
  id: string;
  raw: unknown;
  issue: Issue;
}

/** Shared iterator for one-shot migrations that scan every issue.json. */
export function* forEachOnDiskIssue(): Generator<OnDiskIssue> {
  if (!existsSync(issuesDir)) return;
  for (const id of readdirSync(issuesDir)) {
    const dir = join(issuesDir, id);
    if (!statSync(dir).isDirectory()) continue;
    const jsonPath = join(dir, "issue.json");
    if (!existsSync(jsonPath)) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(jsonPath, "utf8"));
    } catch {
      continue;
    }
    const parsed = parseIssue(raw);
    if (!parsed.ok) continue;
    yield { id, raw, issue: parsed.issue };
  }
}
