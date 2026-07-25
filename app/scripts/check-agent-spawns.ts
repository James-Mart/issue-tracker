#!/usr/bin/env -S npx tsx
// Spawn/pin agreement lint + delegation vocabulary lint.
//
// Frontmatter `model:` on plugin agents is a declaration on the IDE channel
// and the selection mechanism on the app channel. This check walks
// spawn stubs and delegation stubs in `agents/*.md` and `skills/**/*.md`.
//
// Cursor Task stubs (IDE channel): fail when a stub names a missing agent,
// omits a model expression, or (for fixed-model stubs) disagrees with the
// target agent's pin. Stubs parameterized by `<family>` expand to each
// family wrapper and validate that every wrapper exists and carries a
// frontmatter pin.
//
// Delegation stubs (app channel vocabulary): a `` `role: <name>` `` must
// resolve to a spawnable `agents/*.md`, must not name a model, and any file
// that delegates must **Read** `agents/_issue-tracker-delegation.md`.
//
// Files with Task spawn stubs or fixed `` `model: <slug>` `` literals must
// also **Read** that include (workspace-gate style: tolerate `**Read**` and
// the path on adjacent lines).
//
// Run: `npm run lint:spawns` (also part of `npm test`).

import { readdirSync, readFileSync, statSync } from "fs";
import { dirname, relative, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT_DIR = resolve(APP_DIR, "..");

/**
 * Cursor builtins that may still appear in Task stubs — no `agents/*.md` and
 * no pin to agree with. `generalPurpose` is forbidden (see below): a builtin
 * cannot be given a model through the SDK agents map.
 */
const BUILTIN_SUBAGENTS = new Set(["explore"]);

/** Builtins that must not be spawned — use a named plugin agent instead. */
const FORBIDDEN_SUBAGENTS = new Set(["generalPurpose"]);

/** Fixed spawn model slug (no placeholders). */
const FIXED_MODEL_RE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/i;

/** Shared include every stub / fixed-model / delegation file must **Read**. */
const DELEGATION_SUFFIX = "_issue-tracker-delegation.md";

/** `` `model: <slug>` `` anywhere in a scanned file (not just stub windows). */
const FIXED_MODEL_LITERAL_RE = /`model:\s*([^`;\n]+?)`/g;

/**
 * Delegation vocabulary stub: `` `role: <name>` ``.
 * Backtick-delimited so prose like "Comment role:" / "same role: …" does not
 * match.
 */
const ROLE_STUB_RE = /`role:\s*([\w-]+(?:<[\w-]+>)?)`/g;

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

function listAgentFiles(agentsDir: string): string[] {
  return readdirSync(agentsDir)
    .filter((e) => e.endsWith(".md"))
    .map((e) => resolve(agentsDir, e));
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

function loadSpawnableAgents(agentsDir: string): Map<string, AgentPin> {
  const byName = new Map<string, AgentPin>();
  for (const file of listAgentFiles(agentsDir)) {
    const src = readFileSync(file, "utf8");
    const fm = parseFrontmatter(src);
    if (!fm) continue; // shared include (`_*.md` without frontmatter)
    const stem = file.slice(agentsDir.length + 1, -".md".length);
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

interface Delegation {
  file: string;
  line: number;
  role: string;
  /** True when the stub window also names a model (forbidden). */
  hasModelExpression: boolean;
  modelToken: string | null;
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

/** Model expression inside a short forward window from a stub match. */
function modelInWindow(region: string): {
  modelToken: string | null;
  hasModelExpression: boolean;
  fixed: boolean;
} {
  const modelTick = /`model:\s*([^`;\n]+?)`/.exec(region);
  if (modelTick) {
    const modelToken = modelTick[1].trim();
    return {
      modelToken,
      hasModelExpression: true,
      fixed: FIXED_MODEL_RE.test(modelToken),
    };
  }
  if (
    /Cursor Task\s+`model`/.test(region) ||
    /`model`\s+from\b/.test(region) ||
    /`model:`/.test(region)
  ) {
    return { modelToken: null, hasModelExpression: true, fixed: false };
  }
  return { modelToken: null, hasModelExpression: false, fixed: false };
}

function stubWindow(src: string, start: number): string {
  // Window: from match through ~2 blank-line-bounded paragraphs / 400 chars.
  const window = src.slice(start, start + 400);
  const endPara = window.search(/\n\s*\n/);
  return endPara === -1 ? window : window.slice(0, endPara);
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
    const region = stubWindow(src, start);
    const { modelToken, hasModelExpression, fixed } = modelInWindow(region);

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

/**
 * Find `` `role: <name>` `` delegation stubs. A model in the same window is
 * recorded so the checker can forbid caller-supplied models.
 */
function findDelegations(file: string, src: string): Delegation[] {
  const out: Delegation[] = [];
  ROLE_STUB_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ROLE_STUB_RE.exec(src))) {
    const role = m[1];
    const start = m.index;
    const region = stubWindow(src, start);
    const { modelToken, hasModelExpression } = modelInWindow(region);
    out.push({
      file,
      line: lineAt(src, start),
      role,
      hasModelExpression,
      modelToken,
    });
  }
  return out;
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
 * Workspace-gate-style **Read** of the shared Delegation include.
 * Tolerates `**Read**` and the path on the same line or up to three lines
 * above the path reference.
 */
function hasDelegationRead(src: string): boolean {
  if (!src.includes(DELEGATION_SUFFIX)) return false;
  const lines = src.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes(DELEGATION_SUFFIX)) continue;
    for (let j = Math.max(0, i - 3); j <= i; j++) {
      if (/\*\*Read\*\*/.test(lines[j])) return true;
    }
  }
  return false;
}

/**
 * Collect spawn/pin and delegation-vocabulary violations for a plugin root
 * that contains `agents/` and `skills/`.
 */
export function collectSpawnViolations(rootDir: string): string[] {
  const agentsDir = resolve(rootDir, "agents");
  const skillsDir = resolve(rootDir, "skills");
  const rel = (f: string) => relative(rootDir, f);

  const agents = loadSpawnableAgents(agentsDir);
  const scanFiles = [...listAgentFiles(agentsDir), ...walkMd(skillsDir)];
  const violations: string[] = [];

  for (const file of scanFiles) {
    const src = readFileSync(file, "utf8");
    const stubs = findStubs(file, src);
    const delegations = findDelegations(file, src);
    const fixedModels = findFixedModelLiterals(src);

    const readTriggers: string[] = [];
    if (stubs.length > 0) readTriggers.push("spawn stub");
    if (fixedModels.length > 0) readTriggers.push("fixed model literal");
    if (delegations.length > 0) readTriggers.push("delegation");
    if (readTriggers.length > 0 && !hasDelegationRead(src)) {
      violations.push(
        `${rel(file)}: missing **Read** of agents/_issue-tracker-delegation.md (triggered by ${readTriggers.join(" and ")})`,
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

    for (const del of delegations) {
      const loc = `${rel(del.file)}:${del.line}`;

      if (del.hasModelExpression) {
        violations.push(
          `${loc}: delegation role '${del.role}' names a model` +
            (del.modelToken ? ` '${del.modelToken}'` : "") +
            " — the app selects the model from the role pin; do not pass a model",
        );
      }

      if (FORBIDDEN_SUBAGENTS.has(del.role)) {
        violations.push(
          `${loc}: role '${del.role}' is forbidden — use a named plugin agent`,
        );
        continue;
      }

      if (isFamilyParameterized(del.role)) {
        for (const name of expandSubagentTypes(del.role)) {
          if (!agents.get(name)) {
            violations.push(
              `${loc}: family-parameterized role '${del.role}' expands to '${name}' which has no matching spawnable agents/*.md file`,
            );
          }
        }
        continue;
      }

      if (!agents.get(del.role)) {
        violations.push(
          `${loc}: role '${del.role}' has no matching spawnable agents/*.md file`,
        );
      }
    }
  }

  return violations;
}

function runCli(rootDir: string): void {
  const violations = collectSpawnViolations(rootDir);
  if (violations.length === 0) {
    console.log(
      "agent-spawns: OK — every spawn stub names a model; fixed models agree with agent pins; types resolve; family-parameterized stubs expand to pinned wrappers; generalPurpose forbidden; delegations name spawnable roles and no model; stub/model-literal/delegation files **Read** Delegation.",
    );
    process.exit(0);
  }

  console.error(
    `agent-spawns: ${violations.length} spawn/pin agreement violation(s).\n` +
      "Every spawn stub must name a Cursor Task model; fixed-model stubs must match the target agent's frontmatter pin; subagent_type must name a spawnable agents/*.md file (or an allowed Cursor builtin); family-parameterized stubs must expand to pinned family wrappers; generalPurpose is forbidden; `role:` delegations must name a spawnable agents/*.md role and must not name a model; files with spawn stubs, fixed `model: <slug>` literals, or `role:` delegations must **Read** agents/_issue-tracker-delegation.md.\n",
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
