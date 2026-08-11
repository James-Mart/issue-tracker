#!/usr/bin/env -S npx tsx
// Instruction-corpus CLI form lint.
//
// Scans every `.md` file under the plugin root's `agents/` and `skills/`
// directories and fails when instruction prose uses a derivable kind:
//
// 1. Placeholder kind before a kind-uniform verb —
//    `issue <…> view|get|comment|attach|attachments|detach`
//    (correct: `issue <verb> <id>`).
// 2. Placeholder positional after `issue list` that is not `<kind>` —
//    e.g. `issue list <projectId>` (correct: `issue list --in <id>`).
//    Literal kinds (`issue list story`) and the `<kind>` spelling stay valid.
//
// Run: `npm run lint:cli-forms` (also part of `npm test`).

import { readdirSync, readFileSync, statSync } from "fs";
import { dirname, relative, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT_DIR = resolve(APP_DIR, "..");

/** Kind-uniform verbs that must not be preceded by a placeholder kind. */
const KIND_UNIFORM_VERBS =
  "(?:view|get|comment|attachments|attach|detach|merge)";

/**
 * `issue <placeholder> <verb>` — angle-bracket token immediately after
 * `issue`, then a kind-uniform verb.
 */
const PLACEHOLDER_KIND_VERB_RE = new RegExp(
  String.raw`\bissue\s+(<[^>\s]+>)\s+(${KIND_UNIFORM_VERBS})\b`,
  "g",
);

/**
 * `issue list <placeholder>` where the placeholder is not exactly `<kind>`.
 * Literal kinds (`issue list story`) do not match.
 */
const LIST_PLACEHOLDER_RE = /\bissue\s+list\s+(<(?!kind>)[^>\s]+>)/g;

function walkMd(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules") continue;
      out.push(...walkMd(full));
    } else if (entry.endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

function lineAt(src: string, index: number): number {
  return src.slice(0, index).split(/\r?\n/).length;
}

/** Collect CLI-form violations for a plugin root with `agents/` and `skills/`. */
export function collectCliFormViolations(rootDir: string): string[] {
  const agentsDir = resolve(rootDir, "agents");
  const skillsDir = resolve(rootDir, "skills");
  const rel = (f: string) => relative(rootDir, f);
  const scanFiles = [...walkMd(agentsDir), ...walkMd(skillsDir)];
  const violations: string[] = [];

  for (const file of scanFiles) {
    const src = readFileSync(file, "utf8");

    PLACEHOLDER_KIND_VERB_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PLACEHOLDER_KIND_VERB_RE.exec(src))) {
      const offending = m[0];
      const verb = m[2];
      violations.push(
        `${rel(file)}:${lineAt(src, m.index)}: ${offending} — use: issue ${verb} <id>`,
      );
    }

    LIST_PLACEHOLDER_RE.lastIndex = 0;
    while ((m = LIST_PLACEHOLDER_RE.exec(src))) {
      const offending = m[0];
      violations.push(
        `${rel(file)}:${lineAt(src, m.index)}: ${offending} — use: issue list --in <id>`,
      );
    }
  }

  return violations;
}

function runCli(rootDir: string): void {
  const violations = collectCliFormViolations(rootDir);
  if (violations.length === 0) {
    console.log(
      "instruction-cli: OK — no placeholder-kind kind-uniform verbs; no non-<kind> placeholder after issue list.",
    );
    process.exit(0);
  }

  console.error(
    `instruction-cli: ${violations.length} CLI form violation(s).\n` +
      "Kind-uniform verbs (view, get, comment, attach, attachments, detach, merge) must use bare-id `issue <verb> <id>` when the kind is a placeholder; `issue list` must not take a non-<kind> placeholder positional (use `issue list --in <id>`).\n",
  );
  for (const v of violations) {
    console.error(`  ${v}`);
  }
  process.exit(1);
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  runCli(ROOT_DIR);
}
