#!/usr/bin/env -S npx tsx
// Register issue-tracker Shell preToolUse hooks in ~/.cursor/hooks.json.
//
// Run once per machine: `npm run install-hooks` from `app/`.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export type HookEntry = {
  type: "command";
  command: string;
  matcher: string;
};

export type HooksConfig = Record<string, unknown> & {
  version: number;
  hooks: Record<string, unknown> & {
    preToolUse: HookEntry[];
  };
};

function hookEntry(scriptPath: string): HookEntry {
  return {
    type: "command",
    command: `node ${scriptPath}`,
    matcher: "Shell",
  };
}

function isOurHookEntry(entry: unknown, scriptBasename: string): entry is HookEntry {
  return (
    typeof entry === "object" &&
    entry !== null &&
    typeof (entry as HookEntry).command === "string" &&
    (entry as HookEntry).command.includes(scriptBasename)
  );
}

function asHooksObject(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}

/**
 * Merge one hook script registration into parsed hooks.json contents.
 * Idempotent: replaces an existing entry for the same script, never duplicates.
 */
export function ensureHookRegistration(
  config: Record<string, unknown> | undefined,
  scriptPath: string,
): HooksConfig {
  const scriptBasename = basename(scriptPath);
  const entry = hookEntry(scriptPath);
  const base = config ?? {};
  const { preToolUse: staleTopLevelPreToolUse, hooks: existingHooks, ...rest } = base;
  const result: Record<string, unknown> = { ...rest, version: 1 };

  const hooks = asHooksObject(existingHooks);
  const existingPreToolUse =
    hooks.preToolUse !== undefined ? hooks.preToolUse : staleTopLevelPreToolUse;

  let preToolUse: HookEntry[];

  if (existingPreToolUse === undefined) {
    preToolUse = [entry];
  } else if (!Array.isArray(existingPreToolUse)) {
    throw new Error("hooks.json preToolUse must be an array");
  } else {
    const ourIndex = existingPreToolUse.findIndex((item) =>
      isOurHookEntry(item, scriptBasename),
    );

    if (ourIndex === -1) {
      preToolUse = [...(existingPreToolUse as HookEntry[]), entry];
    } else {
      preToolUse = [...(existingPreToolUse as HookEntry[])];
      preToolUse[ourIndex] = entry;
    }
  }

  hooks.preToolUse = preToolUse;
  result.hooks = hooks;
  return result as HooksConfig;
}

/**
 * Merge every required hook script into hooks.json contents, in order.
 */
export function ensureAllHookRegistrations(
  config: Record<string, unknown> | undefined,
  scriptPaths: string[],
): HooksConfig {
  let next: Record<string, unknown> | undefined = config;
  for (const scriptPath of scriptPaths) {
    next = ensureHookRegistration(next, scriptPath);
  }
  return next as HooksConfig;
}

function readHooksConfig(path: string): Record<string, unknown> | undefined {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return undefined;
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `hooks.json is not valid JSON (${path}): ${err instanceof Error ? err.message : err}`,
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`hooks.json top level must be an object (${path})`);
  }

  return parsed as Record<string, unknown>;
}

export function hookScriptPaths(hooksDir: string): string[] {
  return [
    resolve(hooksDir, "strip-cursor-attribution.mjs"),
    resolve(hooksDir, "port-kill-guard.mjs"),
  ];
}

function installHooks(hooksPath: string, scriptPaths: string[]): void {
  const config = readHooksConfig(hooksPath);
  const next = ensureAllHookRegistrations(config, scriptPaths);
  mkdirSync(dirname(hooksPath), { recursive: true });
  writeFileSync(hooksPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  console.log(hooksPath);
}

const isMain =
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  const hooksPath = join(homedir(), ".cursor", "hooks.json");
  const hooksDir = resolve(dirname(fileURLToPath(import.meta.url)), "../hooks");
  installHooks(hooksPath, hookScriptPaths(hooksDir));
}
