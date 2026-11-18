import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { pluginDir } from "../config.js";
import {
  splitFrontmatter,
  type AgentFrontmatter,
} from "./agent-definitions.js";
import { isModelPin, type ModelKey } from "./model-selection.js";

export function defaultAgentsDir(): string {
  return join(pluginDir, "agents");
}

function hasModelPin(model: unknown): model is string {
  return (
    typeof model === "string" && model.length > 0 && model !== "inherit"
  );
}

function requireModelPin(fileName: string, model: unknown): ModelKey {
  if (!hasModelPin(model)) {
    throw new Error(`${fileName}: missing model pin`);
  }
  if (!isModelPin(model)) {
    throw new Error(`${fileName}: unknown model pin "${model}"`);
  }
  return model;
}

function readRoleFile(
  name: string,
  agentsDir: string,
): { fileName: string; frontmatter: AgentFrontmatter } {
  const fileName = `${name}.md`;
  const source = readFileSync(join(agentsDir, fileName), "utf8");
  const parsed = splitFrontmatter(source);
  if (!parsed) {
    throw new Error(`${fileName}: failed to parse frontmatter`);
  }
  return { fileName, frontmatter: parsed.frontmatter };
}

/** Spawnable role ids: `agents/*.md` except includes (`_*`). */
export function listSpawnableRoleIds(
  agentsDir: string = defaultAgentsDir(),
): string[] {
  let entries: string[];
  try {
    entries = readdirSync(agentsDir);
  } catch (err) {
    throw new Error(`agents directory unreadable: ${agentsDir}`, {
      cause: err,
    });
  }
  return entries
    .filter((entry) => entry.endsWith(".md") && !entry.startsWith("_"))
    .map((entry) => entry.slice(0, -".md".length))
    .sort((a, b) => a.localeCompare(b));
}

/** Read a spawnable role's frontmatter model pin. */
export function loadRoleModelPin(
  name: string,
  agentsDir: string = defaultAgentsDir(),
): ModelKey {
  const { fileName, frontmatter } = readRoleFile(name, agentsDir);
  return requireModelPin(fileName, frontmatter.model);
}

function requireReadOnlyFlag(fileName: string, value: unknown): void {
  if (value !== undefined && typeof value !== "boolean") {
    throw new Error(`${fileName}: readonly must be a boolean`);
  }
}

/**
 * Whether the role writes into a Story worktree and so must hold it alone
 * (`worktree: exclusive`). Read-only roles such as reviewers omit it.
 */
export function loadRoleWorktreeExclusive(
  name: string,
  agentsDir: string = defaultAgentsDir(),
): boolean {
  return readRoleFile(name, agentsDir).frontmatter.worktree === "exclusive";
}

/** Frontmatter description for a spawnable role, when the file has one. */
export function loadRoleDescription(
  name: string,
  agentsDir: string = defaultAgentsDir(),
): string | undefined {
  const description = readRoleFile(name, agentsDir).frontmatter.description;
  if (typeof description !== "string") return undefined;
  const trimmed = description.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Fail fast when a spawnable role is missing required frontmatter. */
export function validateRoleBodies(
  agentsDir: string = defaultAgentsDir(),
): void {
  for (const roleId of listSpawnableRoleIds(agentsDir)) {
    const entry = `${roleId}.md`;
    const source = readFileSync(join(agentsDir, entry), "utf8");
    const parsed = splitFrontmatter(source);
    if (!parsed) {
      throw new Error(`${entry}: failed to parse frontmatter`);
    }

    const { name, model, worktree } = parsed.frontmatter;
    if (typeof name !== "string" || name.length === 0) {
      throw new Error(`${entry}: missing name`);
    }
    requireModelPin(entry, model);
    requireReadOnlyFlag(entry, parsed.frontmatter.readonly);
    if (worktree !== undefined && worktree !== "exclusive") {
      throw new Error(`${entry}: worktree must be "exclusive" when set`);
    }
  }
}
