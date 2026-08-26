#!/usr/bin/env -S npx tsx
// Instruction-corpus lint.
//
// Scans instruction prose and fails on disallowed forms:
//
// 1. Placeholder kind before a kind-uniform verb —
//    `issue <…> view|get|comment|attach|attachments|detach`
//    (correct: `issue <verb> <id>`).
//    Scope: every `.md` under `agents/` and `skills/`.
// 2. Placeholder positional after `issue list` that is not `<kind>` —
//    e.g. `issue list <projectId>` (correct: `issue list --in <id>`).
//    Literal kinds (`issue list story`) and the `<kind>` spelling stay valid.
//    Scope: every `.md` under `agents/` and `skills/`.
// 3. Direct `npx tsx cli.ts` invocation (correct: the `issue` binary after
//    one-time `npm link` in this plugin's `app/` directory — see SPEC CLI
//    invariants).
//    Scope: root-level `SPEC.md` and `README.md` (skipped when absent), plus
//    every `.md` under `agents/` and `skills/`.
// 4. Tracker-store file paths — `issues/<id>/description.md`,
//    `issues/<id>/issue.json`, or `issues/<id>/attachments/` (correct: the
//    `issue` CLI; supporting docs via
//    `agents/_issue-tracker-consult-supporting-doc.md`). Bare `issues/`
//    directory mentions stay valid.
//    Scope: every `.md` under `agents/` and `skills/` only.
//
// Run: `npm run lint:cli-forms` (also part of `npm test`).

import { existsSync, readdirSync, readFileSync, statSync } from "fs";
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

/** Direct tsx invocation — agents must use the linked `issue` binary. */
const NPX_TSX_CLI_RE = /\bnpx tsx cli\.ts\b/g;

/**
 * Path into a file inside an issue directory under the tracker store —
 * `issues/<id>/description.md`, `issue.json`, or `attachments/`.
 */
const TRACKER_STORE_FILE_RE =
  /\bissues\/[^/\s`"'<>]+?\/(?:description\.md|issue\.json|attachments\/)/g;

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

function collectNpxTsxCliViolations(
  file: string,
  src: string,
  rel: (f: string) => string,
): string[] {
  const violations: string[] = [];
  NPX_TSX_CLI_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NPX_TSX_CLI_RE.exec(src))) {
    violations.push(
      `${rel(file)}:${lineAt(src, m.index)}: ${m[0]} — use: the issue binary (see SPEC CLI invariants)`,
    );
  }
  return violations;
}

function collectTrackerStoreFileViolations(
  file: string,
  src: string,
  rel: (f: string) => string,
): string[] {
  const violations: string[] = [];
  TRACKER_STORE_FILE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TRACKER_STORE_FILE_RE.exec(src))) {
    violations.push(
      `${rel(file)}:${lineAt(src, m.index)}: ${m[0]} — use: the issue CLI for tracker content; supporting docs via agents/_issue-tracker-consult-supporting-doc.md`,
    );
  }
  return violations;
}

/** Collect CLI-form violations for a plugin root with `agents/` and `skills/`. */
export function collectCliFormViolations(rootDir: string): string[] {
  const agentsDir = resolve(rootDir, "agents");
  const skillsDir = resolve(rootDir, "skills");
  const rel = (f: string) => relative(rootDir, f);
  const instructionFiles = [...walkMd(agentsDir), ...walkMd(skillsDir)];
  const rootDocFiles = ["SPEC.md", "README.md"]
    .map((name) => resolve(rootDir, name))
    .filter((file) => existsSync(file));
  const violations: string[] = [];

  for (const file of instructionFiles) {
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

    violations.push(...collectNpxTsxCliViolations(file, src, rel));
    violations.push(...collectTrackerStoreFileViolations(file, src, rel));
  }

  for (const file of rootDocFiles) {
    const src = readFileSync(file, "utf8");
    violations.push(...collectNpxTsxCliViolations(file, src, rel));
  }

  return violations;
}

function runCli(rootDir: string): void {
  const violations = collectCliFormViolations(rootDir);
  if (violations.length === 0) {
    console.log(
      "instruction-cli: OK — no placeholder-kind kind-uniform verbs; no non-<kind> placeholder after issue list; no npx tsx cli.ts invocations; no tracker-store file paths.",
    );
    process.exit(0);
  }

  console.error(
    `instruction-cli: ${violations.length} instruction-corpus violation(s).\n` +
      "Kind-uniform verbs (view, get, comment, attach, attachments, detach, merge) must use bare-id `issue <verb> <id>` when the kind is a placeholder; `issue list` must not take a non-<kind> placeholder positional (use `issue list --in <id>`); invoke the CLI via the linked `issue` binary, not `npx tsx cli.ts`; read tracker content via the `issue` CLI and supporting docs via agents/_issue-tracker-consult-supporting-doc.md, not filesystem paths under issues/<id>/.\n",
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
