import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appDir } from "../config.js";
import { validateHookRegistration } from "./hook-registration.js";

const SCRIPT_PATH = join(appDir, "hooks", "strip-cursor-attribution.mjs");
const STALE_SCRIPT_PATH =
  "/old/checkout/app/hooks/strip-cursor-attribution.mjs";
const INSTALL_COMMAND = "npm run install-hooks";

const hookEntry = (scriptPath: string) => ({
  type: "command",
  command: `node ${scriptPath}`,
  matcher: "Shell",
});

let homeDir: string;

function writeHooksConfig(config: unknown): void {
  const dir = join(homeDir, ".cursor");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "hooks.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), "issue-hook-registration-"));
});

afterEach(() => {
  rmSync(homeDir, { recursive: true, force: true });
});

describe("validateHookRegistration", () => {
  it("passes when hooks.preToolUse registers this checkout's script", () => {
    writeHooksConfig({
      version: 1,
      hooks: {
        preToolUse: [hookEntry(SCRIPT_PATH)],
      },
    });

    expect(() => validateHookRegistration(homeDir)).not.toThrow();
  });

  it("throws when hooks.json is missing", () => {
    expect(() => validateHookRegistration(homeDir)).toThrow(/hooks\.json is missing/);
    expect(() => validateHookRegistration(homeDir)).toThrow(new RegExp(INSTALL_COMMAND));
  });

  it("throws when hooks.preToolUse lacks the entry", () => {
    writeHooksConfig({
      version: 1,
      hooks: {
        preToolUse: [
          {
            type: "command",
            command: "node /other/hook.mjs",
            matcher: "Shell",
          },
        ],
      },
    });

    expect(() => validateHookRegistration(homeDir)).toThrow(/not registered under hooks\.preToolUse/);
    expect(() => validateHookRegistration(homeDir)).toThrow(new RegExp(INSTALL_COMMAND));
  });

  it("throws when the entry points at a stale script path", () => {
    writeHooksConfig({
      version: 1,
      hooks: {
        preToolUse: [hookEntry(STALE_SCRIPT_PATH)],
      },
    });

    expect(() => validateHookRegistration(homeDir)).toThrow(/not registered under hooks\.preToolUse/);
    expect(() => validateHookRegistration(homeDir)).toThrow(new RegExp(INSTALL_COMMAND));
  });

  it("throws when the entry is only at the top level and hooks is empty", () => {
    writeHooksConfig({
      version: 1,
      hooks: {},
      preToolUse: [hookEntry(SCRIPT_PATH)],
    });

    expect(() => validateHookRegistration(homeDir)).toThrow(/not registered under hooks\.preToolUse/);
    expect(() => validateHookRegistration(homeDir)).toThrow(new RegExp(INSTALL_COMMAND));
  });
});
