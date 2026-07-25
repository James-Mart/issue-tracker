import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { pluginDir } from "../config.js";
import { splitFrontmatter } from "./agent-definitions.js";

function defaultAgentsDir(): string {
  return join(pluginDir, "agents");
}

function hasModelPin(model: unknown): boolean {
  return (
    typeof model === "string" && model.length > 0 && model !== "inherit"
  );
}

/** Read a spawnable role's markdown body with YAML frontmatter stripped. */
export function loadRoleBody(
  name: string,
  agentsDir: string = defaultAgentsDir(),
): string {
  const fileName = `${name}.md`;
  const source = readFileSync(join(agentsDir, fileName), "utf8");
  const parsed = splitFrontmatter(source);
  if (!parsed) {
    throw new Error(`${fileName}: failed to parse frontmatter`);
  }
  return parsed.prompt;
}

/** Fail fast when a spawnable role is missing required frontmatter. */
export function validateRoleBodies(
  agentsDir: string = defaultAgentsDir(),
): void {
  let entries: string[];
  try {
    entries = readdirSync(agentsDir);
  } catch (err) {
    throw new Error(`agents directory unreadable: ${agentsDir}`, {
      cause: err,
    });
  }

  for (const entry of entries) {
    if (!entry.endsWith(".md") || entry.startsWith("_")) continue;

    const source = readFileSync(join(agentsDir, entry), "utf8");
    const parsed = splitFrontmatter(source);
    if (!parsed) {
      throw new Error(`${entry}: failed to parse frontmatter`);
    }

    const { name, model } = parsed.frontmatter;
    if (typeof name !== "string" || name.length === 0) {
      throw new Error(`${entry}: missing name`);
    }
    if (!hasModelPin(model)) {
      throw new Error(`${entry}: missing model pin`);
    }
  }
}
