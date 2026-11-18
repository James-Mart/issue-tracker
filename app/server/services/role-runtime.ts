import { existsSync, readFileSync } from "fs";
import { basename, dirname, join, resolve } from "path";
import type {
  McpServerConfig,
  SDKCustomTool,
  SettingSource,
  ToolName,
} from "@cursor/sdk";
import { z } from "zod";
import { splitFrontmatter } from "./agent-definitions.js";
import type { AgentCapabilities } from "./agent-sdk.js";
import { playwrightMcpServer } from "./playwright-mcp.js";
import { defaultAgentsDir } from "./role-bodies.js";

const MANIFEST_FILE = "capabilities.json";

const CUSTOM_TOOL_NAMES = [
  "delegate",
  "delegations",
  "file_cursor_sdk_bug",
  "agent_stack_start",
  "agent_stack_stop",
  "agent_stack_redeploy",
  "issue_read",
  "git_read",
] as const;

export type CustomToolName = (typeof CUSTOM_TOOL_NAMES)[number];

/** The verification stack belongs to a conversation; spawns without one omit it. */
const AGENT_STACK_TOOLS: ReadonlySet<CustomToolName> = new Set([
  "agent_stack_start",
  "agent_stack_stop",
  "agent_stack_redeploy",
]);

const MCP_SERVERS: Record<
  "playwright",
  (conversationId: string | undefined) => McpServerConfig
> = {
  playwright: playwrightMcpServer,
};

const settingSourceSchema = z.enum([
  "project",
  "user",
  "team",
  "mdm",
  "plugins",
  "all",
]) satisfies z.ZodType<SettingSource>;

const capabilitiesSchema = z.strictObject({
  settingSources: z.array(settingSourceSchema),
  inject: z.array(
    z.strictObject({
      kind: z.enum(["skill", "rule"]),
      path: z.string().min(1),
    }),
  ),
  customTools: z.array(z.enum(CUSTOM_TOOL_NAMES)),
  builtins: z.array(z.string().min(1)),
  mcp: z.array(z.enum(["playwright"])),
});

const manifestSchema = z.strictObject({
  default: capabilitiesSchema,
  profiles: z.record(z.string(), capabilitiesSchema),
  roles: z.record(z.string(), z.strictObject({ profile: z.string() })),
});

type ManifestCapabilities = z.infer<typeof capabilitiesSchema>;

export interface RoleRuntimeContext {
  /** A fresh create attaches inject; a resume rebinds everything else. */
  fresh: boolean;
  /** App conversation that owns the session, when one is present. */
  conversationId?: string;
}

export interface InjectRow {
  kind: "skill" | "rule" | "role";
  name: string;
  /** Absolute path of the markdown file whose body is injected. */
  path: string;
}

export interface RoleRuntime {
  settingSources: SettingSource[];
  /** Empty on a resume: the agent already carries it from its first turn. */
  inject: InjectRow[];
  customTools: CustomToolName[];
  builtins: ToolName[];
  mcp: Record<string, McpServerConfig>;
}

function loadCapabilityManifest(agentsDir: string): z.infer<typeof manifestSchema> {
  const path = join(agentsDir, MANIFEST_FILE);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`${path}: unreadable capability manifest`, { cause: err });
  }
  const result = manifestSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`${path}: ${z.prettifyError(result.error)}`);
  }
  const manifest = result.data;
  for (const [role, entry] of Object.entries(manifest.roles)) {
    if (role.startsWith("_") || !existsSync(join(agentsDir, `${role}.md`))) {
      throw new Error(`${path}: "${role}" matches no spawnable role`);
    }
    if (!Object.hasOwn(manifest.profiles, entry.profile)) {
      throw new Error(`${path}: "${role}" names unknown profile "${entry.profile}"`);
    }
  }
  return manifest;
}

function injectRow(
  agentsDir: string,
  row: ManifestCapabilities["inject"][number],
): InjectRow {
  const path = resolve(agentsDir, row.path);
  const name =
    row.kind === "skill" ? basename(dirname(path)) : basename(path, ".md");
  return { kind: row.kind, name, path };
}

/**
 * The capability contract one spawn runs with. `role` is the spawnable role
 * id; omit it for spawns with no role (the implementing coordinator, outline
 * planning, a manual message on an issue channel), which resolve the shared
 * default. The role file keeps only the model pin; profile membership comes
 * from the manifest's role entry.
 */
export function resolveRoleRuntime(
  role: string | undefined,
  context: RoleRuntimeContext,
  agentsDir: string = defaultAgentsDir(),
): RoleRuntime {
  const manifest = loadCapabilityManifest(agentsDir);
  const entry = role === undefined ? undefined : manifest.roles[role];
  const capabilities =
    entry === undefined ? manifest.default : manifest.profiles[entry.profile]!;
  const roleRow: InjectRow[] =
    role === undefined
      ? []
      : [{ kind: "role", name: role, path: join(agentsDir, `${role}.md`) }];
  const hasConversation = context.conversationId !== undefined;

  return {
    settingSources: [...capabilities.settingSources],
    inject: context.fresh
      ? [...capabilities.inject.map((row) => injectRow(agentsDir, row)), ...roleRow]
      : [],
    customTools: capabilities.customTools.filter(
      (name) => hasConversation || !AGENT_STACK_TOOLS.has(name),
    ),
    builtins: [...capabilities.builtins],
    mcp: Object.fromEntries(
      capabilities.mcp.map((name) => [
        name,
        MCP_SERVERS[name](context.conversationId),
      ]),
    ),
  };
}

/** The SDK options a resolved runtime configures, given its built tool map. */
export function agentCapabilities(
  runtime: RoleRuntime,
  customTools: Record<string, SDKCustomTool>,
): AgentCapabilities {
  return {
    settingSources: runtime.settingSources,
    customTools,
    builtins: runtime.builtins,
    mcp: runtime.mcp,
  };
}

function injectBody(row: InjectRow): string {
  const source = readFileSync(row.path, "utf8");
  // Rule includes carry no frontmatter; skills and role files do.
  if (!source.startsWith("---")) return source.trim();
  const parsed = splitFrontmatter(source);
  if (!parsed) {
    throw new Error(`${row.path}: failed to parse frontmatter`);
  }
  return parsed.prompt.trim();
}

/** Prefix the task message with the inject a fresh create attaches. */
export function withInject(
  inject: readonly InjectRow[],
  message: string,
): string {
  return [...inject.map(injectBody), message].join("\n\n");
}
