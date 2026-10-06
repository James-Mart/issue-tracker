import { existsSync, readdirSync, readFileSync, statSync, type BigIntStats } from "fs";
import { join } from "path";
import { issuesDir } from "../config.js";
import type { Issue, Problem } from "../schemas.js";
import {
  issueJsonPath,
  missingIssueJson,
  parseIssueText,
  type ParsedIssue,
} from "./issues-file.js";

// A parsed view of every issue.json, shared across reads. Issues are frozen:
// a caller that mutates one would corrupt every later read in this process.
export interface IssueSnapshot {
  issues: readonly Issue[];
  byId: ReadonlyMap<string, Issue>;
  problems: readonly Problem[];
  // Changes whenever any issue is added, removed, or rewritten with new content.
  version: number;
}

interface Entry {
  statKey: string;
  mtimeMs: number;
  verifiedAtMs: number;
  text: string;
  parsed: ParsedIssue;
}

// Filesystem timestamps are coarse (kernel ticks on ext4, whole seconds on
// HFS+, two seconds on FAT), so a rewrite inside the same tick can leave every
// stat field unchanged. A file modified this close to when we last read it is
// re-read rather than trusted on stats alone.
const RACY_WINDOW_MS = 2000;

let cache:
  | { dir: string; ids: string[]; entries: Map<string, Entry | undefined>; snapshot: IssueSnapshot }
  | undefined;
let nextVersion = 1;

function scanIds(): string[] {
  if (!existsSync(issuesDir)) return [];
  return readdirSync(issuesDir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() ||
        (entry.isSymbolicLink() &&
          statSync(join(issuesDir, entry.name)).isDirectory()),
    )
    .map((entry) => entry.name);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function revalidate(
  id: string,
  stats: BigIntStats,
  prior: Entry | undefined,
  nowMs: number,
): Entry {
  const statKey = `${stats.ino}:${stats.size}:${stats.mtimeNs}:${stats.ctimeNs}`;
  if (
    prior &&
    prior.statKey === statKey &&
    prior.mtimeMs < prior.verifiedAtMs - RACY_WINDOW_MS
  ) {
    return prior;
  }
  const text = readFileSync(issueJsonPath(id), "utf8");
  return {
    statKey,
    mtimeMs: Number(stats.mtimeMs),
    verifiedAtMs: nowMs,
    text,
    parsed: prior?.text === text ? prior.parsed : deepFreeze(parseIssueText(id, text)),
  };
}

function build(ids: string[], entries: Map<string, Entry | undefined>): IssueSnapshot {
  const issues: Issue[] = [];
  const problems: Problem[] = [];
  for (const id of ids) {
    const entry = entries.get(id);
    if (!entry) {
      problems.push(missingIssueJson(id));
      continue;
    }
    if (entry.parsed.issue) issues.push(entry.parsed.issue);
    if (entry.parsed.problem) problems.push(entry.parsed.problem);
  }
  return {
    issues: Object.freeze(issues),
    byId: new Map(issues.map((issue) => [issue.id, issue])),
    problems: deepFreeze(problems),
    version: nextVersion++,
  };
}

/**
 * The store's parsed issues, revalidated against each issue.json's stats on
 * every call: unchanged files cost a stat, and only new or rewritten files are
 * read and parsed. Writes from any process are visible on the next call.
 */
export function readSnapshot(): IssueSnapshot {
  // Captured before any stat so a write racing this scan reads as recent.
  const nowMs = Date.now();
  const prior = cache?.dir === issuesDir ? cache : undefined;
  const ids = scanIds();
  let changed =
    !prior ||
    ids.length !== prior.ids.length ||
    ids.some((id, index) => id !== prior.ids[index]);
  const entries = new Map<string, Entry | undefined>();
  for (const id of ids) {
    const priorEntry = prior?.entries.get(id);
    const stats = statSync(issueJsonPath(id), { bigint: true, throwIfNoEntry: false });
    const entry = stats ? revalidate(id, stats, priorEntry, nowMs) : undefined;
    if (entry?.parsed !== priorEntry?.parsed) changed = true;
    entries.set(id, entry);
  }
  const snapshot = prior && !changed ? prior.snapshot : build(ids, entries);
  cache = { dir: issuesDir, ids, entries, snapshot };
  return snapshot;
}
