import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const INSTALL_COMMAND = "npm run install-hooks";

/** Basenames of Shell preToolUse hook scripts that must be registered. */
export function expectedHookScriptBasenames(): string[] {
  return ["strip-cursor-attribution.mjs", "port-kill-guard.mjs"];
}

function registrationError(detail: string): Error {
  return new Error(
    `${detail} Run \`${INSTALL_COMMAND}\` from the primary checkout's \`app/\` to register the required Shell preToolUse hooks.`,
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

function preToolUseCommands(config: Record<string, unknown>): string[] {
  const hooks = config.hooks;
  if (typeof hooks !== "object" || hooks === null || Array.isArray(hooks)) {
    return [];
  }

  const preToolUse = (hooks as Record<string, unknown>).preToolUse;
  if (!Array.isArray(preToolUse)) {
    return [];
  }

  const commands: string[] = [];
  for (const entry of preToolUse) {
    if (
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as { command?: unknown }).command === "string"
    ) {
      commands.push((entry as { command: string }).command);
    }
  }
  return commands;
}

/**
 * Extract the filesystem path token that ends with `scriptBasename` from a
 * hooks.json command string (e.g. `node /path/to/strip-cursor-attribution.mjs`).
 */
export function scriptPathFromCommand(
  command: string,
  scriptBasename: string,
): string | undefined {
  const idx = command.indexOf(scriptBasename);
  if (idx === -1) return undefined;

  let start = idx;
  while (start > 0 && !/\s/.test(command[start - 1]!)) {
    start -= 1;
  }
  return command.slice(start, idx + scriptBasename.length);
}

/** Fail fast when required Shell hooks are missing from ~/.cursor/hooks.json. */
export function validateHookRegistration(homeDir: string = homedir()): void {
  const config = readHooksConfig(homeDir);
  const commands = preToolUseCommands(config);

  const missing: string[] = [];
  for (const scriptBasename of expectedHookScriptBasenames()) {
    const command = commands.find((entry) => entry.includes(scriptBasename));
    if (command === undefined) {
      missing.push(scriptBasename);
      continue;
    }

    const registeredPath = scriptPathFromCommand(command, scriptBasename);
    if (registeredPath === undefined || !existsSync(registeredPath)) {
      throw registrationError(
        `${scriptBasename} is registered in hooks.preToolUse but the script file is missing` +
          (registeredPath !== undefined ? ` at ${registeredPath}.` : "."),
      );
    }
  }

  if (missing.length > 0) {
    throw registrationError(
      `${missing.join(", ")} not registered under hooks.preToolUse in ~/.cursor/hooks.json.`,
    );
  }
}
