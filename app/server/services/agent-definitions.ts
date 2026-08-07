import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import type { AgentDefinition } from "@cursor/sdk";
import { parse as parseYaml } from "yaml";
import { pluginDir } from "../config.js";

export interface AgentFrontmatter {
  name?: unknown;
  description?: unknown;
  model?: unknown;
}

export function splitFrontmatter(
  src: string,
): { frontmatter: AgentFrontmatter; prompt: string } | null {
  if (!src.startsWith("---\n") && !src.startsWith("---\r\n")) return null;
  const end = src.indexOf("\n---", 4);
  if (end === -1) return null;

  let parsed: unknown;
  try {
    parsed = parseYaml(src.slice(4, end));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const prompt = src.slice(end + "\n---".length).trimStart();
  return { frontmatter: parsed as AgentFrontmatter, prompt };
}

function toAgentDefinition(
  frontmatter: AgentFrontmatter,
  prompt: string,
): AgentDefinition | null {
  if (typeof frontmatter.name !== "string" || frontmatter.name.length === 0) {
    return null;
  }

  const definition: AgentDefinition = {
    description:
      typeof frontmatter.description === "string"
        ? frontmatter.description
        : "",
    prompt,
  };

  if (
    typeof frontmatter.model === "string" &&
    frontmatter.model.length > 0 &&
    frontmatter.model !== "inherit"
  ) {
    // The pin slug is the id this surface wants. Subagent definitions take
    // compound slugs (`claude-opus-5-thinking-high`) and reject base catalog
    // ids; `Agent.create` is the opposite, which is what
    // `resolveModelSelection` exists for. Do not route this through it.
    definition.model = { id: frontmatter.model };
  }

  return definition;
}

/** Load spawnable plugin agents from `agents/*.md` into SDK definitions. */
export function loadAgentDefinitions(
  agentsDir: string,
): Record<string, AgentDefinition> {
  const definitions: Record<string, AgentDefinition> = {};

  let entries: string[];
  try {
    entries = readdirSync(agentsDir);
  } catch {
    return definitions;
  }

  for (const entry of entries) {
    if (!entry.endsWith(".md") || entry.startsWith("_")) continue;

    const filePath = join(agentsDir, entry);
    let source: string;
    try {
      source = readFileSync(filePath, "utf8");
    } catch {
      continue;
    }

    const parsed = splitFrontmatter(source);
    if (!parsed) continue;

    const definition = toAgentDefinition(parsed.frontmatter, parsed.prompt);
    if (!definition) continue;

    definitions[parsed.frontmatter.name as string] = definition;
  }

  return definitions;
}

/** Load agent definitions from this plugin's `agents/` directory. */
export function loadPluginAgentDefinitions(): Record<string, AgentDefinition> {
  return loadAgentDefinitions(join(pluginDir, "agents"));
}
