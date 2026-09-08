#!/usr/bin/env -S npx tsx
import { randomUUID } from "node:crypto";
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { issuesDir, refreshStorePathsFromEnv } from "../server/config.js";
import { commentInputSchema } from "../server/schemas/issue.js";

const legacyStoredCommentSchema = commentInputSchema.extend({
  at: z.string().min(1),
});

export interface MalformedCommentLine {
  file: string;
  line: number;
  message: string;
}

export interface MigrateCommentIdsResult {
  filesProcessed: number;
  linesMigrated: number;
  malformed: MalformedCommentLine[];
}

function* findCommentsJsonlFiles(root: string): Generator<string> {
  if (!existsSync(root)) return;
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    if (statSync(path).isDirectory()) {
      yield* findCommentsJsonlFiles(path);
    } else if (name === "comments.jsonl") {
      yield path;
    }
  }
}

function lineCarriesId(raw: unknown): boolean {
  return typeof raw === "object" && raw !== null && "id" in raw;
}

function migrateCommentsFile(
  path: string,
): { migrated: number; malformed: MalformedCommentLine[] } {
  const content = readFileSync(path, "utf8");
  const lines = content.split("\n");
  const outLines: string[] = [];
  let changed = false;
  let migrated = 0;
  const malformed: MalformedCommentLine[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!line.trim()) {
      outLines.push(line);
      continue;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      malformed.push({ file: path, line: index + 1, message: detail });
      outLines.push(line);
      continue;
    }

    if (lineCarriesId(raw)) {
      outLines.push(line);
      continue;
    }

    const parsed = legacyStoredCommentSchema.safeParse(raw);
    if (!parsed.success) {
      malformed.push({
        file: path,
        line: index + 1,
        message: parsed.error.issues[0]?.message ?? "invalid comment line",
      });
      outLines.push(line);
      continue;
    }

    outLines.push(JSON.stringify({ ...parsed.data, id: randomUUID() }));
    changed = true;
    migrated += 1;
  }

  if (changed) {
    writeFileSync(path, outLines.join("\n"));
  }

  return { migrated, malformed };
}

export function migrateCommentIds(): MigrateCommentIdsResult {
  refreshStorePathsFromEnv();

  let filesProcessed = 0;
  let linesMigrated = 0;
  const malformed: MalformedCommentLine[] = [];

  for (const path of findCommentsJsonlFiles(issuesDir)) {
    filesProcessed += 1;
    const result = migrateCommentsFile(path);
    linesMigrated += result.migrated;
    malformed.push(...result.malformed);
  }

  return { filesProcessed, linesMigrated, malformed };
}

const isMain =
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  const result = migrateCommentIds();
  for (const problem of result.malformed) {
    console.error(
      `${problem.file}:${problem.line}: malformed comment line — ${problem.message}`,
    );
  }
  if (result.linesMigrated > 0) {
    console.log(
      `migrated ${result.linesMigrated} comment line(s) across ${result.filesProcessed} file(s)`,
    );
  }
}
