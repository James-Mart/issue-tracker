import { existsSync, readdirSync, readFileSync, statSync, type BigIntStats } from "fs";
import { join } from "path";
import { issuesDir } from "../config.js";
import type { Issue, Problem } from "../schemas.js";
import {
  commentsJsonPath,
  issueJsonPath,
  missingIssueJson,
  parseIssueText,
  type ParsedIssue,
} from "./issues-file.js";
import { splitCommentLog } from "./thread-state.js";

// A parsed view of every issue.json, shared across reads. Issues are frozen:
// a caller that mutates one would corrupt every later read in this process.
export interface IssueSnapshot {
  issues: readonly Issue[];
  byId: ReadonlyMap<string, Issue>;
  problems: readonly Problem[];
  // Malformed-comment problems for parsed issues. Refreshed when a comments.jsonl
  // changes; that refresh does not bump `version`.
  commentProblems: readonly Problem[];
  // Changes whenever any issue is added, removed, or rewritten with new content.
  version: number;
}

interface StatCache {
  statKey: string;
  mtimeMs: number;
  verifiedAtMs: number;
}

interface Entry extends StatCache {
  text: string;
  parsed: ParsedIssue;
}

interface CommentEntry extends StatCache {
  problems: readonly Problem[];
}

const ABSENT_STAT_KEY = "";

// Filesystem timestamps are coarse (kernel ticks on ext4, whole seconds on
// HFS+, two seconds on FAT), so a rewrite inside the same tick can leave every
// stat field unchanged. A file modified this close to when we last read it is
// re-read rather than trusted on stats alone.
const RACY_WINDOW_MS = 2000;

let cache:
  | {
      dir: string;
      ids: string[];
      entries: Map<string, Entry | undefined>;
      comments: Map<string, CommentEntry>;
      snapshot: IssueSnapshot;
    }
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

function fileStatKey(stats: BigIntStats): string {
  return `${stats.ino}:${stats.size}:${stats.mtimeNs}:${stats.ctimeNs}`;
}

function cachedIfUnchanged<T extends StatCache>(
  prior: T | undefined,
  statKey: string,
): T | undefined {
  if (
    prior &&
    prior.statKey === statKey &&
    prior.mtimeMs < prior.verifiedAtMs - RACY_WINDOW_MS
  ) {
    return prior;
  }
  return undefined;
}

function revalidate(
  id: string,
  stats: BigIntStats,
  prior: Entry | undefined,
  nowMs: number,
): Entry {
  const statKey = fileStatKey(stats);
  const cached = cachedIfUnchanged(prior, statKey);
  if (cached) return cached;
  const text = readFileSync(issueJsonPath(id), "utf8");
  return {
    statKey,
    mtimeMs: Number(stats.mtimeMs),
    verifiedAtMs: nowMs,
    text,
    parsed: prior?.text === text ? prior.parsed : deepFreeze(parseIssueText(id, text)),
  };
}

function sameProblems(a: readonly Problem[], b: readonly Problem[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].message !== b[i].message) return false;
  }
  return true;
}

function revalidateComments(
  id: string,
  stats: BigIntStats | undefined,
  prior: CommentEntry | undefined,
  nowMs: number,
): CommentEntry {
  if (!stats) {
    if (prior?.statKey === ABSENT_STAT_KEY) return prior;
    return {
      statKey: ABSENT_STAT_KEY,
      mtimeMs: 0,
      verifiedAtMs: nowMs,
      problems: Object.freeze([]),
    };
  }
  const statKey = fileStatKey(stats);
  const cached = cachedIfUnchanged(prior, statKey);
  if (cached) return cached;
  const fresh = splitCommentLog(id, readFileSync(commentsJsonPath(id), "utf8")).problems;
  return {
    statKey,
    mtimeMs: Number(stats.mtimeMs),
    verifiedAtMs: nowMs,
    problems: prior && sameProblems(prior.problems, fresh) ? prior.problems : deepFreeze(fresh),
  };
}

function build(
  ids: string[],
  entries: Map<string, Entry | undefined>,
  commentProblems: readonly Problem[],
): IssueSnapshot {
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
    commentProblems,
    version: nextVersion++,
  };
}

/**
 * The store's parsed issues, revalidated against each issue.json's stats on
 * every call: unchanged files cost a stat, and only new or rewritten files are
 * read and parsed. Writes from any process are visible on the next call.
 * comments.jsonl problem results are revalidated the same way.
 */
export function readSnapshot(): IssueSnapshot {
  // Captured before any stat so a write racing this scan reads as recent.
  const nowMs = Date.now();
  const prior = cache?.dir === issuesDir ? cache : undefined;
  const ids = scanIds();
  const idsChanged =
    !prior ||
    ids.length !== prior.ids.length ||
    ids.some((id, index) => id !== prior.ids[index]);
  let issuesChanged = idsChanged;
  const entries = new Map<string, Entry | undefined>();
  const comments = new Map<string, CommentEntry>();
  const commentProblems: Problem[] = [];
  let commentsChanged = !prior;
  for (const id of ids) {
    const priorEntry = prior?.entries.get(id);
    const stats = statSync(issueJsonPath(id), { bigint: true, throwIfNoEntry: false });
    const entry = stats ? revalidate(id, stats, priorEntry, nowMs) : undefined;
    if (entry?.parsed !== priorEntry?.parsed) issuesChanged = true;
    entries.set(id, entry);
    if (!entry?.parsed.issue) {
      if (prior?.comments.has(id)) commentsChanged = true;
      continue;
    }

    const commentStats = statSync(commentsJsonPath(id), {
      bigint: true,
      throwIfNoEntry: false,
    });
    const previous = prior?.comments.get(id);
    const commentEntry = revalidateComments(id, commentStats, previous, nowMs);
    comments.set(id, commentEntry);
    if (commentEntry.problems !== previous?.problems) commentsChanged = true;
    if (commentEntry.problems.length > 0) commentProblems.push(...commentEntry.problems);
  }
  if (idsChanged) commentsChanged = true;
  const published =
    prior && !commentsChanged ? prior.snapshot.commentProblems : deepFreeze(commentProblems);
  let snapshot: IssueSnapshot;
  if (prior && !issuesChanged && !commentsChanged) {
    snapshot = prior.snapshot;
  } else if (prior && !issuesChanged) {
    snapshot = { ...prior.snapshot, commentProblems: published };
  } else {
    snapshot = build(ids, entries, published);
  }
  cache = { dir: issuesDir, ids, entries, comments, snapshot };
  return snapshot;
}
