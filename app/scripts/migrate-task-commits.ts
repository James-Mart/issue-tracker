#!/usr/bin/env -S npx tsx
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { issuesDir, refreshStorePathsFromEnv } from "../server/config.js";
import { validateFullCommitSha } from "../server/services/commit-sha.js";

export interface MalformedTaskCommit {
  file: string;
  message: string;
}

export interface MigrateTaskCommitsResult {
  tasksProcessed: number;
  tasksMigrated: number;
  malformed: MalformedTaskCommit[];
}

function isValidCommitSha(sha: unknown): sha is string {
  if (typeof sha !== "string") return false;
  try {
    validateFullCommitSha(sha);
    return true;
  } catch {
    return false;
  }
}

function* findIssueJsonFiles(root: string): Generator<string> {
  if (!existsSync(root)) return;
  for (const name of readdirSync(root)) {
    const dir = join(root, name);
    if (!statSync(dir).isDirectory()) continue;
    const jsonPath = join(dir, "issue.json");
    if (existsSync(jsonPath)) yield jsonPath;
  }
}

function migrateTaskIssueJson(path: string): {
  isTask: boolean;
  migrated: boolean;
  malformed?: MalformedTaskCommit;
} {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      isTask: false,
      migrated: false,
      malformed: { file: path, message: detail },
    };
  }

  if (typeof raw !== "object" || raw === null) {
    return {
      isTask: false,
      migrated: false,
      malformed: { file: path, message: "issue.json is not an object" },
    };
  }

  const record = raw as Record<string, unknown>;
  if (record.kind !== "task") {
    return { isTask: false, migrated: false };
  }

  if ("commits" in record) {
    return { isTask: true, migrated: false };
  }

  if (!("commitSha" in record)) {
    return { isTask: true, migrated: false };
  }

  const commitSha = record.commitSha;
  if (!isValidCommitSha(commitSha)) {
    return {
      isTask: true,
      migrated: false,
      malformed: {
        file: path,
        message: `invalid commit sha "${String(commitSha)}" (expected full 40- or 64-character hex object name)`,
      },
    };
  }

  const { commitSha: _removed, ...rest } = record;
  writeFileSync(path, `${JSON.stringify({ ...rest, commits: [commitSha] })}\n`);
  return { isTask: true, migrated: true };
}

export function migrateTaskCommits(): MigrateTaskCommitsResult {
  refreshStorePathsFromEnv();

  let tasksProcessed = 0;
  let tasksMigrated = 0;
  const malformed: MalformedTaskCommit[] = [];

  for (const path of findIssueJsonFiles(issuesDir)) {
    const result = migrateTaskIssueJson(path);
    if (result.isTask) tasksProcessed += 1;
    if (result.migrated) tasksMigrated += 1;
    if (result.malformed) malformed.push(result.malformed);
  }

  return { tasksProcessed, tasksMigrated, malformed };
}

const isMain =
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  const result = migrateTaskCommits();
  for (const problem of result.malformed) {
    console.error(`${problem.file}: malformed commitSha — ${problem.message}`);
  }
  if (result.tasksMigrated > 0) {
    console.log(
      `migrated ${result.tasksMigrated} task(s) across ${result.tasksProcessed} task file(s)`,
    );
  }
}
