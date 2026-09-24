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

export interface MigrateOutlineGateResult {
  ideasProcessed: number;
  ideasMigrated: number;
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

function migrateIdeaIssueJson(path: string): {
  isIdea: boolean;
  migrated: boolean;
} {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return { isIdea: false, migrated: false };
  }

  if (typeof raw !== "object" || raw === null) {
    return { isIdea: false, migrated: false };
  }

  const record = raw as Record<string, unknown>;
  if (record.kind !== "idea") {
    return { isIdea: false, migrated: false };
  }

  if (!("approvePlan" in record)) {
    return { isIdea: true, migrated: false };
  }

  const { approvePlan, ...rest } = record;
  writeFileSync(
    path,
    `${JSON.stringify({ ...rest, outlineGate: approvePlan })}\n`,
  );
  return { isIdea: true, migrated: true };
}

export function migrateOutlineGate(): MigrateOutlineGateResult {
  refreshStorePathsFromEnv();

  let ideasProcessed = 0;
  let ideasMigrated = 0;

  for (const path of findIssueJsonFiles(issuesDir)) {
    const result = migrateIdeaIssueJson(path);
    if (result.isIdea) ideasProcessed += 1;
    if (result.migrated) ideasMigrated += 1;
  }

  return { ideasProcessed, ideasMigrated };
}

const isMain =
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  const result = migrateOutlineGate();
  if (result.ideasMigrated > 0) {
    console.log(
      `migrated ${result.ideasMigrated} idea(s) across ${result.ideasProcessed} idea file(s)`,
    );
  }
}
