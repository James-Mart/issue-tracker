import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { PLUGIN_APP_DIR, isInsideDir } from "./harness-paths.js";

function absolutePathSchema(field: string) {
  return z.string().superRefine((value, ctx) => {
    if (!path.isAbsolute(value)) {
      ctx.addIssue({
        code: "custom",
        message: `${field}: ${value}`,
      });
    }
  });
}

export const harnessConfigSchema = z
  .object({
    targetRoot: absolutePathSchema("targetRoot"),
    reactRoot: absolutePathSchema("reactRoot"),
    cssEntries: z.array(absolutePathSchema("cssEntries")),
    aliases: z.record(z.string(), absolutePathSchema("aliases")),
    storiesGlobs: z.array(z.string().min(1)),
    viteConfigPath: absolutePathSchema("viteConfigPath").optional(),
  })
  .strict();

export type HarnessConfig = z.infer<typeof harnessConfigSchema>;

function formatZodError(error: z.ZodError): string {
  const first = error.issues[0];
  if (!first) return "invalid harness configuration";
  const field = first.path.length > 0 ? String(first.path[0]) : "harness configuration";
  if (first.code === "custom" && typeof first.message === "string") {
    return first.message;
  }
  return `${field}: ${first.message}`;
}

function assertExists(field: string, value: string): void {
  if (!existsSync(value)) {
    throw new Error(`${field}: ${value}`);
  }
}

function assertOutsidePluginApp(field: string, value: string): void {
  if (isInsideDir(PLUGIN_APP_DIR, realpathSync(value))) {
    throw new Error(`${field}: ${value} is inside the plugin app ${PLUGIN_APP_DIR}`);
  }
}

export function loadHarnessConfig(configPath: string): HarnessConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${configPath}: ${message}`);
  }

  const result = harnessConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(formatZodError(result.error));
  }

  const config = result.data;
  assertExists("targetRoot", config.targetRoot);
  assertExists("reactRoot", config.reactRoot);
  for (const entry of config.cssEntries) {
    assertExists("cssEntries", entry);
  }
  for (const [alias, aliasPath] of Object.entries(config.aliases)) {
    assertExists(`aliases.${alias}`, aliasPath);
    assertOutsidePluginApp(`aliases.${alias}`, aliasPath);
  }
  if (config.viteConfigPath !== undefined) {
    assertExists("viteConfigPath", config.viteConfigPath);
  }

  return config;
}
