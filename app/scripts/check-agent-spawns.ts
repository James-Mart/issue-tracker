#!/usr/bin/env -S npx tsx
// Spawn/pin agreement lint.
//
// Frontmatter `model:` on plugin agents is a declaration, not a selector.
// Spawn-time Cursor Task `model` is what actually selects. This check walks
// spawn stubs in `agents/*.md` and `skills/**/*.md` and fails when a stub
// names a missing agent, omits a model expression, or (for fixed-model stubs)
// disagrees with the target agent's pin.
//
// Stubs parameterized by `<family>` expand to each family wrapper and validate
// that every wrapper exists and carries a frontmatter pin.
//
// Files with spawn stubs or fixed `` `model: <slug>` `` literals must also
// **Read** `agents/_issue-tracker-model-availability.md` (workspace-gate
// style: tolerate `**Read**` and the path on adjacent lines).
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

/** Shared include every stub / fixed-model file must **Read**. */
const MODEL_AVAILABILITY_SUFFIX = "_issue-tracker-model-availability.md";

/** `` `model: <slug>` `` anywhere in a scanned file (not just stub windows). */
const FIXED_MODEL_LITERAL_RE = /`model:\s*([^`;\n]+?)`/g;

/** Families a `<family>`-parameterized stub must resolve against. */
const FAMILIES = ["composer", "grok", "opus"] as const;

const FAMILY_PLACEHOLDER = "<family>";

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

/** Expand `…-<family>` to one concrete type per family; otherwise identity. */
function expandSubagentTypes(subagentType: string): string[] {
  if (!subagentType.endsWith(FAMILY_PLACEHOLDER)) return [subagentType];
  const prefix = subagentType.slice(0, -FAMILY_PLACEHOLDER.length);
  return FAMILIES.map((f) => `${prefix}${f}`);
}

function isFamilyParameterized(subagentType: string): boolean {
  return subagentType.endsWith(FAMILY_PLACEHOLDER);
}

/**
 * Find `subagent_type: <name>` stubs and the nearest model expression in a
 * short forward window (same stub block).
 */
function findStubs(file: string, src: string): Stub[] {
  const stubs: Stub[] = [];
  // Allow the name on the next line inside the same code span / stub block.
  // Capture optional `<family>` (or other angle-bracket placeholder).
  const typeRe = /subagent_type:\s*([\w-]+(?:<[\w-]+>)?)/g;
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
      /`model`\s+from\b/.test(region) ||
      /`model:`/.test(region)
    ) {
      // Parameterized prose, e.g. Implement stub / family wrapper pin.
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

/** Fixed `` `model: <slug>` `` literals in the whole file. */
function findFixedModelLiterals(
  src: string,
): { line: number; slug: string }[] {
  const hits: { line: number; slug: string }[] = [];
  let m: RegExpExecArray | null;
  FIXED_MODEL_LITERAL_RE.lastIndex = 0;
  while ((m = FIXED_MODEL_LITERAL_RE.exec(src))) {
    const slug = m[1].trim();
    if (FIXED_MODEL_RE.test(slug)) {
      hits.push({ line: lineAt(src, m.index), slug });
    }
  }
  return hits;
}

/**
 * Workspace-gate-style **Read** of the shared Model availability include.
 * Tolerates `**Read**` and the path on the same line or up to three lines
 * above the path reference.
 */
function hasModelAvailabilityRead(src: string): boolean {
  if (!src.includes(MODEL_AVAILABILITY_SUFFIX)) return false;
  const lines = src.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes(MODEL_AVAILABILITY_SUFFIX)) continue;
    for (let j = Math.max(0, i - 3); j <= i; j++) {
      if (/\*\*Read\*\*/.test(lines[j])) return true;
    }
  }
  return false;
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
  const stubs = findStubs(file, src);
  const fixedModels = findFixedModelLiterals(src);

  const readTriggers: string[] = [];
  if (stubs.length > 0) readTriggers.push("spawn stub");
  if (fixedModels.length > 0) readTriggers.push("fixed model literal");
  if (readTriggers.length > 0 && !hasModelAvailabilityRead(src)) {
    violations.push(
      `${rel(file)}: missing **Read** of agents/_issue-tracker-model-availability.md (triggered by ${readTriggers.join(" and ")})`,
    );
  }

  for (const stub of stubs) {
    const loc = `${rel(stub.file)}:${stub.line}`;
    if (FORBIDDEN_SUBAGENTS.has(stub.subagentType)) {
      violations.push(
        `${loc}: subagent_type '${stub.subagentType}' is forbidden — use a named plugin agent (builtins cannot be given a model through the SDK agents map)`,
      );
      continue;
    }

    if (!stub.hasModelExpression) {
      violations.push(
        `${loc}: spawn stub for '${stub.subagentType}' names no Cursor Task model`,
      );
      continue;
    }

    if (isFamilyParameterized(stub.subagentType)) {
      if (stub.fixed) {
        violations.push(
          `${loc}: family-parameterized '${stub.subagentType}' must not pin a single fixed spawn model '${stub.modelToken}' — use each family's wrapper pin`,
        );
      }
      for (const name of expandSubagentTypes(stub.subagentType)) {
        const agent = agents.get(name);
        if (!agent) {
          violations.push(
            `${loc}: family-parameterized '${stub.subagentType}' expands to '${name}' which has no matching spawnable agents/*.md file`,
          );
          continue;
        }
        if (agent.model === undefined) {
          violations.push(
            `${loc}: family wrapper '${name}' has no frontmatter model pin`,
          );
        }
      }
      continue;
    }

    const builtin = BUILTIN_SUBAGENTS.has(stub.subagentType);
    const agent = agents.get(stub.subagentType);

    if (!builtin && !agent) {
      violations.push(
        `${loc}: subagent_type '${stub.subagentType}' has no matching spawnable agents/*.md file`,
      );
    }

    if (builtin || !stub.fixed || !agent) continue;

    // Parameterized stubs (prose / non-fixed tokens) skip pin equality.
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
    "agent-spawns: OK — every spawn stub names a model; fixed models agree with agent pins; types resolve; family-parameterized stubs expand to pinned wrappers; generalPurpose forbidden; stub/model-literal files **Read** Model availability.",
  );
  process.exit(0);
}

console.error(
  `agent-spawns: ${violations.length} spawn/pin agreement violation(s).\n` +
    "Every spawn stub must name a Cursor Task model; fixed-model stubs must match the target agent's frontmatter pin; subagent_type must name a spawnable agents/*.md file (or an allowed Cursor builtin); family-parameterized stubs must expand to pinned family wrappers; generalPurpose is forbidden; files with spawn stubs or fixed `model: <slug>` literals must **Read** agents/_issue-tracker-model-availability.md.\n",
);
for (const v of violations) {
  console.error(`  ${v}`);
}
process.exit(1);
