import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { appDir } from "../config.js";

const INSTALL_COMMAND = "npm run install-hooks";

function expectedScriptPath(): string {
  return join(appDir, "hooks", "strip-cursor-attribution.mjs");
}

function registrationError(detail: string): Error {
  return new Error(
    `${detail} Run \`${INSTALL_COMMAND}\` from \`app/\` to register the strip-cursor-attribution hook.`,
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

/** Fail fast when strip-cursor-attribution is missing from ~/.cursor/hooks.json. */
export function validateHookRegistration(homeDir: string = homedir()): void {
  const scriptPath = expectedScriptPath();

  if (!existsSync(scriptPath)) {
    throw registrationError(`Hook script is missing at ${scriptPath}.`);
  }

  const config = readHooksConfig(homeDir);

  if (!isRegisteredUnderHooks(config, scriptPath)) {
    throw registrationError(
      "strip-cursor-attribution is not registered under hooks.preToolUse in ~/.cursor/hooks.json.",
    );
  }
}
