#!/usr/bin/env -S npx tsx
// Skill-path resolution lint.
//
// Scans instruction prose and launch composers and fails when cited plugin
// paths do not resolve on disk:
//
// 1. Instruction corpus — every `.md` under `agents/` and `skills/`: paths
//    beginning with the installed plugin prefix must exist.
// 2. Launch composers — every `*-launch.ts` under
//    `app/src/features/issues/lib/`: `skillPath("<name>")` must resolve to
//    `skills/<name>/SKILL.md` under the plugin root.
//
// Run: `npm run lint:skill-paths` (also part of `npm test`).

import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { dirname, relative, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT_DIR = resolve(APP_DIR, "..");

/** Installed plugin prefix cited in instruction prose. */
const PLUGIN_PATH_RE =
  /\/root\/\.cursor\/plugins\/local\/issue-tracker(?:\/[\w.-]+)+/g;

/** Trailing markdown/code punctuation trimmed from a cited path. */
const TRAILING_PUNCT_RE = /[.,)\]`"'>\;]+$/;

/** Launch-composer helper call sites. */
const SKILL_PATH_CALL_RE = /skillPath\s*\(\s*["']([^"']+)["']\s*\)/g;

export type SkillPathViolation = {
  file: string;
  line: number;
  target: string;
};

function lineAt(src: string, index: number): number {
  return src.slice(0, index).split(/\r?\n/).length;
}

function trimPathTarget(raw: string): string {
  return raw.replace(TRAILING_PUNCT_RE, "");
}

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

function walkLaunchComposers(launchDir: string): string[] {
  if (!existsSync(launchDir)) return [];
  return readdirSync(launchDir)
    .filter((entry) => entry.endsWith("-launch.ts"))
    .map((entry) => resolve(launchDir, entry));
}

/** Collect unresolved plugin paths for a plugin root. */
export function collectSkillPathViolations(
  rootDir: string,
): SkillPathViolation[] {
  const violations: SkillPathViolation[] = [];
  const rel = (f: string) => relative(rootDir, f);

  const agentsDir = resolve(rootDir, "agents");
  const skillsDir = resolve(rootDir, "skills");
  const launchDir = resolve(rootDir, "app/src/features/issues/lib");

  const instructionFiles: string[] = [];
  if (existsSync(agentsDir)) instructionFiles.push(...walkMd(agentsDir));
  if (existsSync(skillsDir)) instructionFiles.push(...walkMd(skillsDir));

  for (const file of instructionFiles) {
    const src = readFileSync(file, "utf8");

    PLUGIN_PATH_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PLUGIN_PATH_RE.exec(src))) {
      const target = trimPathTarget(m[0]);
      if (!existsSync(target)) {
        violations.push({
          file: rel(file),
          line: lineAt(src, m.index),
          target,
        });
      }
    }
  }

  for (const file of walkLaunchComposers(launchDir)) {
    const src = readFileSync(file, "utf8");

    SKILL_PATH_CALL_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = SKILL_PATH_CALL_RE.exec(src))) {
      const skillName = m[1]!;
      const target = resolve(rootDir, "skills", skillName, "SKILL.md");
      if (!existsSync(target)) {
        violations.push({
          file: rel(file),
          line: lineAt(src, m.index),
          target,
        });
      }
    }
  }

  return violations;
}

function runCli(rootDir: string): void {
  const violations = collectSkillPathViolations(rootDir);
  if (violations.length === 0) {
    console.log(
      "skill-paths: OK — every cited plugin path resolves on disk.",
    );
    process.exit(0);
  }

  console.error(
    `skill-paths: ${violations.length} unresolved plugin path(s).\n` +
      "Instruction corpus paths and launch-composer skillPath() calls must resolve under the plugin root.\n",
  );
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}: ${v.target}`);
  }
  process.exit(1);
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  runCli(ROOT_DIR);
}
