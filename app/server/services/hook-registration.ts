import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { appDir } from "../config.js";

const INSTALL_COMMAND = "npm run install-hooks";

export function expectedHookScriptPaths(): string[] {
  return [
    join(appDir, "hooks", "strip-cursor-attribution.mjs"),
    join(appDir, "hooks", "port-kill-guard.mjs"),
  ];
}

function registrationError(detail: string): Error {
  return new Error(
    `${detail} Run \`${INSTALL_COMMAND}\` from \`app/\` to register the required Shell preToolUse hooks.`,
  );
}

function readHooksConfig(homeDir: string): Record<string, unknown> {
  const hooksPath = join(homeDir, ".cursor", "hooks.json");
  let raw: string;
  try {
    raw = readFileSync(hooksPath, "utf8");
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      throw registrationError("~/.cursor/hooks.json is missing.");
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `hooks.json is not valid JSON (${hooksPath}): ${err instanceof Error ? err.message : err}`,
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`hooks.json top level must be an object (${hooksPath})`);
  }

  return parsed as Record<string, unknown>;
}

function commandReferencesScript(command: string, scriptPath: string): boolean {
  return command.includes(scriptPath);
}

function isRegisteredUnderHooks(
  config: Record<string, unknown>,
  scriptPath: string,
): boolean {
  const hooks = config.hooks;
  if (typeof hooks !== "object" || hooks === null || Array.isArray(hooks)) {
    return false;
  }

  const preToolUse = (hooks as Record<string, unknown>).preToolUse;
  if (!Array.isArray(preToolUse)) {
    return false;
  }

  return preToolUse.some(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as { command?: unknown }).command === "string" &&
      commandReferencesScript(
        (entry as { command: string }).command,
        scriptPath,
      ),
  );
}

/** Fail fast when required Shell hooks are missing from ~/.cursor/hooks.json. */
export function validateHookRegistration(homeDir: string = homedir()): void {
  const scriptPaths = expectedHookScriptPaths();

  for (const scriptPath of scriptPaths) {
    if (!existsSync(scriptPath)) {
      throw registrationError(`Hook script is missing at ${scriptPath}.`);
    }
  }

  const config = readHooksConfig(homeDir);

  const missing = scriptPaths.filter(
    (scriptPath) => !isRegisteredUnderHooks(config, scriptPath),
  );
  if (missing.length > 0) {
    const names = missing.map((path) => basename(path)).join(", ");
    throw registrationError(
      `${names} not registered under hooks.preToolUse in ~/.cursor/hooks.json.`,
    );
  }
}
