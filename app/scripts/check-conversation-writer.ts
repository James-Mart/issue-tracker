#!/usr/bin/env -S npx tsx
// Conversation-store single-writer lint.
//
// The API server's conversation service is the only writer of conversation
// `meta.json` and `transcript.jsonl`. In-memory conversation state is written
// through by that service and is stale if anything else writes those files.
//
// A non-test source file fails this check when it writes either filename, or
// when it both calls a filesystem write and names `metaPathOf` / `transcriptPathOf`.
// Writers that belong to the service are allowlisted:
// `server/services/conversation-meta-index.ts` (meta.json write-through),
// `server/services/conversations.ts` (transcript create and append),
// and `server/services/conversation-fork.ts` (inherited transcript copy).
//
// Run: `npm run lint:conversation-writer` (also part of `npm test`).

import { readdirSync, readFileSync, statSync } from "fs";
import { dirname, relative, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT_DIR = resolve(APP_DIR, "..");

/** Conversation-service modules that may write meta and transcript files. */
const ALLOWED_WRITERS = new Set([
  "server/services/conversation-meta-index.ts",
  "server/services/conversations.ts",
  "server/services/conversation-fork.ts",
]);

const WRITE_CALL_RE =
  /\b(?:writeFileSync|appendFileSync|createWriteStream|writeFile|appendFile)\s*\(/;

const STORE_FILE_IN_CALL_RE = /["'`](?:meta\.json|transcript\.jsonl)["'`]/;

const STORE_PATH_HELPER_RE = /\b(?:metaPathOf|transcriptPathOf)\s*\(/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "dist") continue;
      out.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function isTestSource(relPath: string): boolean {
  return (
    /\.(?:test|spec)\.tsx?$/.test(relPath) ||
    /\.fixtures\.tsx?$/.test(relPath) ||
    /(?:^|\/)[^/]*test-fixtures[^/]*\.tsx?$/.test(relPath) ||
    /(?:^|\/)[^/]*test-helpers[^/]*\.tsx?$/.test(relPath)
  );
}

function writeCallStoresConversationFile(src: string): boolean {
  const re = new RegExp(WRITE_CALL_RE.source, "g");
  for (const match of src.matchAll(re)) {
    const start = (match.index ?? 0) + match[0].length;
    if (STORE_FILE_IN_CALL_RE.test(src.slice(start, start + 400))) return true;
  }
  return false;
}

function writesViaStorePathHelper(src: string): boolean {
  return WRITE_CALL_RE.test(src) && STORE_PATH_HELPER_RE.test(src);
}

/**
 * App-relative paths that write conversation `meta.json` or `transcript.jsonl`
 * outside the conversation service. `rootDir` is the plugin root.
 */
export function collectConversationWriterViolations(rootDir: string): string[] {
  const appDir = resolve(rootDir, "app");
  const violations: string[] = [];
  for (const file of walk(appDir)) {
    const relToApp = relative(appDir, file);
    if (relToApp === "scripts/check-conversation-writer.ts") continue;
    if (ALLOWED_WRITERS.has(relToApp) || isTestSource(relToApp)) continue;
    const src = readFileSync(file, "utf8");
    if (writeCallStoresConversationFile(src) || writesViaStorePathHelper(src)) {
      violations.push(relative(rootDir, file));
    }
  }
  violations.sort((a, b) => a.localeCompare(b));
  return violations;
}

function runCli(rootDir: string): void {
  const violations = collectConversationWriterViolations(rootDir);
  if (violations.length === 0) {
    console.log(
      "conversation-writer: OK — only the conversation service writes meta.json and transcript.jsonl.",
    );
    process.exit(0);
  }

  console.error(
    `conversation-writer: ${violations.length} file(s) write conversation meta.json or transcript.jsonl outside the conversation service.\n` +
      "Those writes belong in the conversation service (conversation-meta-index.ts, conversations.ts, or conversation-fork.ts) so the metadata index stays current.\n",
  );
  for (const file of violations) {
    console.error(`  ${file}`);
  }
  process.exit(1);
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  runCli(ROOT_DIR);
}
