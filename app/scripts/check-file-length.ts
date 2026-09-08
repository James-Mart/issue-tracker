#!/usr/bin/env -S npx tsx
// File-length lint.
//
// Fails when any in-scope source file exceeds FILE_LENGTH_LIMIT newlines
// (`wc -l` semantics). Scope:
//
// 1. `app/**/*.ts` and `app/**/*.tsx` (excluding `node_modules` and `dist`)
// 2. Every first-party file under `agents/` and `skills/`
//
// Run: `npm run lint:file-length` (also part of `npm test`).

import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { dirname, relative, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT_DIR = resolve(APP_DIR, "..");

export const FILE_LENGTH_LIMIT = 1000;

export type FileLengthViolation = {
  file: string;
  lines: number;
  kind: "over-limit";
};

/** Newline count matching `wc -l`. */
function countLines(content: string): number {
  let lines = 0;
  for (let i = 0; i < content.length; i++) {
    if (content[i] === "\n") lines++;
  }
  return lines;
}

function walkAppSource(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "dist") continue;
      out.push(...walkAppSource(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function walkFirstParty(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules") continue;
      out.push(...walkFirstParty(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

function collectFromFile(
  rootDir: string,
  file: string,
  violations: FileLengthViolation[],
): void {
  const lines = countLines(readFileSync(file, "utf8"));
  if (lines > FILE_LENGTH_LIMIT) {
    violations.push({
      file: relative(rootDir, file),
      lines,
      kind: "over-limit",
    });
  }
}

/** Collect files over FILE_LENGTH_LIMIT for a plugin root. */
export function collectFileLengthViolations(
  rootDir: string,
): FileLengthViolation[] {
  const violations: FileLengthViolation[] = [];
  const appDir = resolve(rootDir, "app");
  const agentsDir = resolve(rootDir, "agents");
  const skillsDir = resolve(rootDir, "skills");

  if (existsSync(appDir)) {
    for (const file of walkAppSource(appDir)) {
      collectFromFile(rootDir, file, violations);
    }
  }

  for (const dir of [agentsDir, skillsDir]) {
    if (!existsSync(dir)) continue;
    for (const file of walkFirstParty(dir)) {
      collectFromFile(rootDir, file, violations);
    }
  }

  violations.sort((a, b) => a.file.localeCompare(b.file));
  return violations;
}

function runCli(rootDir: string): void {
  const violations = collectFileLengthViolations(rootDir);
  if (violations.length === 0) {
    console.log(
      `file-length: OK — every in-scope file is at or under ${FILE_LENGTH_LIMIT} lines.`,
    );
    process.exit(0);
  }

  console.error(
    `file-length: ${violations.length} file(s) over ${FILE_LENGTH_LIMIT} lines.\n` +
      "Split oversized files before merging; there is no allowlist.\n",
  );
  for (const v of violations) {
    console.error(`  ${v.file}: ${v.lines} lines (${v.kind})`);
  }
  process.exit(1);
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  runCli(ROOT_DIR);
}
