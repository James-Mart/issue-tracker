#!/usr/bin/env -S npx tsx
// Spawn/pin agreement lint.
//
// Frontmatter `model:` on plugin agents is a declaration, not a selector.
// Spawn-time Cursor Task `model` is what actually selects. This check walks
// spawn stubs in `agents/*.md` and `skills/**/*.md` and fails when a stub
// names a missing agent, omits a model expression, or (for fixed-model stubs)
// disagrees with the target agent's pin.
//
// Run: `npm run lint:spawns` (also part of `npm test`).

import { readdirSync, readFileSync, statSync } from "fs";
import { dirname, relative, resolve } from "path";
import { fileURLToPath } from "url";

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT_DIR = resolve(APP_DIR, "..");
const AGENTS_DIR = resolve(ROOT_DIR, "agents");
const SKILLS_DIR = resolve(ROOT_DIR, "skills");

/**
 * Cursor builtins that may still appear in stubs — no `agents/*.md` and no
 * pin to agree with. `generalPurpose` is forbidden (see below): a builtin
 * cannot be given a model through the SDK agents map.
 */
const BUILTIN_SUBAGENTS = new Set(["explore"]);

/** Builtins that must not be spawned — use a named plugin agent instead. */
const FORBIDDEN_SUBAGENTS = new Set(["generalPurpose"]);

/** Fixed spawn model slug (no placeholders). */
const FIXED_MODEL_RE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/i;

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

function listAgentFiles(): string[] {
  return readdirSync(AGENTS_DIR)
    .filter((e) => e.endsWith(".md"))
    .map((e) => resolve(AGENTS_DIR, e));
}

/** Parse YAML frontmatter; spawnable agents have a frontmatter block. */
function parseFrontmatter(
  src: string,
): { name?: string; model?: string } | null {
  if (!src.startsWith("---\n") && !src.startsWith("---\r\n")) return null;
  const end = src.indexOf("\n---", 4);
  if (end === -1) return null;
  const block = src.slice(4, end);
  const fields: { name?: string; model?: string } = {};
  for (const line of block.split(/\r?\n/)) {
    const m = /^(name|model):\s*(.+?)\s*$/.exec(line);
    if (!m) continue;
    const key = m[1] as "name" | "model";
    fields[key] = m[2];
  }
  return fields;
}

interface AgentPin {
  file: string;
  name: string;
  model: string | undefined;
}

function loadSpawnableAgents(): Map<string, AgentPin> {
  const byName = new Map<string, AgentPin>();
  for (const file of listAgentFiles()) {
    const src = readFileSync(file, "utf8");
    const fm = parseFrontmatter(src);
    if (!fm) continue; // shared include (`_*.md` without frontmatter)
    const stem = file.slice(AGENTS_DIR.length + 1, -".md".length);
    const name = fm.name ?? stem;
    byName.set(name, { file, name, model: fm.model });
    if (stem !== name) byName.set(stem, { file, name, model: fm.model });
  }
  return byName;
}

interface Stub {
  file: string;
  line: number;
  subagentType: string;
  /** Raw model token from `model: …`, or null when only a non-literal expression. */
  modelToken: string | null;
  /** True when the stub names any Cursor Task model expression. */
  hasModelExpression: boolean;
  fixed: boolean;
}

function lineAt(src: string, index: number): number {
  return src.slice(0, index).split(/\r?\n/).length;
}

/**
 * Find `subagent_type: <name>` stubs and the nearest model expression in a
 * short forward window (same stub block).
 */
function findStubs(file: string, src: string): Stub[] {
  const stubs: Stub[] = [];
  // Allow the name on the next line inside the same code span / stub block.
  const typeRe = /subagent_type:\s*([\w-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = typeRe.exec(src))) {
    const subagentType = m[1];
    const start = m.index;
    // Window: from match through ~2 blank-line-bounded paragraphs / 400 chars.
    const window = src.slice(start, start + 400);
    const endPara = window.search(/\n\s*\n/);
    const region = endPara === -1 ? window : window.slice(0, endPara);

    const modelTick = /`model:\s*([^`;\n]+?)`/.exec(region);
    let modelToken: string | null = null;
    let hasModelExpression = false;
    let fixed = false;

    if (modelTick) {
      hasModelExpression = true;
      modelToken = modelTick[1].trim();
      if (FIXED_MODEL_RE.test(modelToken)) {
        fixed = true;
      }
    } else if (
      /Cursor Task\s+`model`/.test(region) ||
      /`model`\s+from\b/.test(region)
    ) {
      // Parameterized prose, e.g. Implement stub.
      hasModelExpression = true;
    }

    stubs.push({
      file,
      line: lineAt(src, start),
      subagentType,
      modelToken,
      hasModelExpression,
      fixed,
    });
  }
  return stubs;
}

const rel = (f: string) => relative(ROOT_DIR, f);

const agents = loadSpawnableAgents();
const scanFiles = [
  ...listAgentFiles(),
  ...walkMd(SKILLS_DIR),
];

const violations: string[] = [];

for (const file of scanFiles) {
  const src = readFileSync(file, "utf8");
  for (const stub of findStubs(file, src)) {
    const loc = `${rel(stub.file)}:${stub.line}`;
    if (FORBIDDEN_SUBAGENTS.has(stub.subagentType)) {
      violations.push(
        `${loc}: subagent_type '${stub.subagentType}' is forbidden — use a named plugin agent (builtins cannot be given a model through the SDK agents map)`,
      );
      continue;
    }
    const builtin = BUILTIN_SUBAGENTS.has(stub.subagentType);
    const agent = agents.get(stub.subagentType);

    if (!builtin && !agent) {
      violations.push(
        `${loc}: subagent_type '${stub.subagentType}' has no matching spawnable agents/*.md file`,
      );
    }

    if (!stub.hasModelExpression) {
      violations.push(
        `${loc}: spawn stub for '${stub.subagentType}' names no Cursor Task model`,
      );
      continue;
    }

    if (builtin || !stub.fixed || !agent) continue;

    // Parameterized stubs (angle brackets / prose) skip pin equality.
    // issue-tracker-implementor's call sites are parameterized while its pin
    // is `inherit`, so they must not be flagged here.
    if (agent.model === undefined) {
      violations.push(
        `${loc}: agent '${stub.subagentType}' has no frontmatter model pin to agree with spawn model '${stub.modelToken}'`,
      );
      continue;
    }
    if (stub.modelToken !== agent.model) {
      violations.push(
        `${loc}: spawn model '${stub.modelToken}' disagrees with agents/${stub.subagentType}.md pin '${agent.model}'`,
      );
    }
  }
}

if (violations.length === 0) {
  console.log(
    "agent-spawns: OK — every spawn stub names a model; fixed models agree with agent pins; types resolve; generalPurpose forbidden.",
  );
  process.exit(0);
}

console.error(
  `agent-spawns: ${violations.length} spawn/pin agreement violation(s).\n` +
    "Every spawn stub must name a Cursor Task model; fixed-model stubs must match the target agent's frontmatter pin; subagent_type must name a spawnable agents/*.md file (or an allowed Cursor builtin); generalPurpose is forbidden.\n",
);
for (const v of violations) {
  console.error(`  ${v}`);
}
process.exit(1);
