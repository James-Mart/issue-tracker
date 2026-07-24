import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { issuesDir } from "../config.js";

const BACKFILL_FLAG = ".kind-renamed-story-task";

const KIND_MAP: Record<string, string> = {
  branch: "story",
  commit: "task",
};

function flagPath(): string {
  return join(issuesDir, BACKFILL_FLAG);
}

export function kindRenameDone(): boolean {
  return existsSync(flagPath());
}

export function markKindRenamed(): void {
  mkdirSync(issuesDir, { recursive: true });
  writeFileSync(flagPath(), "");
}

export interface KindRenameResult {
  updated: string[];
  skipped: boolean;
  /** Set when the marker was withheld because migration could not finish cleanly. */
  incompleteReason?: string;
}

interface ScanEntry {
  id: string;
  jsonPath: string;
  obj: Record<string, unknown> | null;
  parseError?: string;
}

/**
 * Walk every issue.json. Unreadable files are retained with `obj: null` so the
 * caller can withhold the marker without crashing `list()`.
 */
function scanIssueJsonFiles(): ScanEntry[] {
  if (!existsSync(issuesDir)) return [];
  const entries: ScanEntry[] = [];
  for (const id of readdirSync(issuesDir)) {
    const dir = join(issuesDir, id);
    if (!statSync(dir).isDirectory()) continue;
    const jsonPath = join(dir, "issue.json");
    if (!existsSync(jsonPath)) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(jsonPath, "utf8"));
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      entries.push({ id, jsonPath, obj: null, parseError: reason });
      continue;
    }
    if (!raw || typeof raw !== "object") {
      entries.push({
        id,
        jsonPath,
        obj: null,
        parseError: "not a JSON object",
      });
      continue;
    }
    entries.push({ id, jsonPath, obj: raw as Record<string, unknown> });
  }
  return entries;
}

function remainingLegacyKinds(entries: ScanEntry[]): string[] {
  const leftover: string[] = [];
  for (const { id, obj } of entries) {
    if (obj && (obj.kind === "branch" || obj.kind === "commit")) leftover.push(id);
  }
  return leftover;
}

/**
 * One-shot: rewrite stored `kind` `branch`→`story` and `commit`→`task` on every
 * issue.json. Runs before schema parse of those kinds; no dual-read afterward.
 * Subsequent calls no-op once the marker exists.
 *
 * The marker is written only after confirming zero `branch`/`commit` kinds remain
 * and every issue.json was readable. Incomplete runs leave the marker unset so a
 * later `list()` retries — they do not throw, so malformed dirs still surface as
 * `list()` problems instead of crashing the CLI/UI.
 */
export function ensureKindRenamed(): KindRenameResult {
  if (kindRenameDone()) return { updated: [], skipped: true };

  if (!existsSync(issuesDir)) {
    markKindRenamed();
    return { updated: [], skipped: false };
  }

  const entries = scanIssueJsonFiles();
  const updated: string[] = [];

  for (const { id, jsonPath, obj } of entries) {
    if (!obj || typeof obj.kind !== "string") continue;
    const nextKind = KIND_MAP[obj.kind];
    if (!nextKind) continue;
    // Skip id/directory mismatches — must not create a sibling directory.
    if (typeof obj.id === "string" && obj.id !== id) continue;
    obj.kind = nextKind;
    writeFileSync(jsonPath, `${JSON.stringify(obj, null, 2)}\n`);
    updated.push(id);
  }

  const unreadable = entries.filter((e) => e.obj === null).map((e) => e.id);
  const leftover = remainingLegacyKinds(entries);
  if (unreadable.length > 0 || leftover.length > 0) {
    const parts: string[] = [];
    if (leftover.length > 0) {
      parts.push(`still have kind branch|commit: ${leftover.join(", ")}`);
    }
    if (unreadable.length > 0) {
      parts.push(`unreadable issue.json: ${unreadable.join(", ")}`);
    }
    return {
      updated,
      skipped: false,
      incompleteReason: parts.join("; "),
    };
  }

  markKindRenamed();
  return { updated, skipped: false };
}
