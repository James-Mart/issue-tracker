import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appDir } from "../config.js";
import {
  expectedHookScriptBasenames,
  scriptPathFromCommand,
  validateHookRegistration,
} from "./hook-registration.js";

const STRIP_PATH = join(appDir, "hooks", "strip-cursor-attribution.mjs");
const KILL_GUARD_PATH = join(appDir, "hooks", "port-kill-guard.mjs");
const SCRIPT_PATHS = [STRIP_PATH, KILL_GUARD_PATH];
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

describe("scriptPathFromCommand", () => {
  it("extracts the path token ending in the basename", () => {
    expect(
      scriptPathFromCommand(
        "node /primary/app/hooks/strip-cursor-attribution.mjs",
        "strip-cursor-attribution.mjs",
      ),
    ).toBe("/primary/app/hooks/strip-cursor-attribution.mjs");
  });
});

describe("validateHookRegistration", () => {
  it("exposes the required hook basenames", () => {
    expect(expectedHookScriptBasenames()).toEqual([
      "strip-cursor-attribution.mjs",
      "port-kill-guard.mjs",
    ]);
  });

  it("passes when hooks.preToolUse registers every required script", () => {
    writeHooksConfig({
      version: 1,
      hooks: {
        preToolUse: SCRIPT_PATHS.map(hookEntry),
      },
    });

    expect(() => validateHookRegistration(homeDir)).not.toThrow();
  });

  it("passes when registered paths are outside this checkout but exist", () => {
    const otherDir = mkdtempSync(join(tmpdir(), "other-hooks-"));
    const otherStrip = join(otherDir, "strip-cursor-attribution.mjs");
    const otherKill = join(otherDir, "port-kill-guard.mjs");
    writeFileSync(otherStrip, "// stub\n");
    writeFileSync(otherKill, "// stub\n");

    writeHooksConfig({
      version: 1,
      hooks: {
        preToolUse: [hookEntry(otherStrip), hookEntry(otherKill)],
      },
    });

    try {
      expect(() => validateHookRegistration(homeDir)).not.toThrow();
    } finally {
      rmSync(otherDir, { recursive: true, force: true });
    }
  });

  it("throws when hooks.json is missing", () => {
    expect(() => validateHookRegistration(homeDir)).toThrow(/hooks\.json is missing/);
    expect(() => validateHookRegistration(homeDir)).toThrow(new RegExp(INSTALL_COMMAND));
  });

  it("throws when hooks.preToolUse lacks an entry", () => {
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

  it("throws when only the attribution hook is registered", () => {
    writeHooksConfig({
      version: 1,
      hooks: {
        preToolUse: [hookEntry(STRIP_PATH)],
      },
    });

    expect(() => validateHookRegistration(homeDir)).toThrow(/port-kill-guard\.mjs/);
    expect(() => validateHookRegistration(homeDir)).toThrow(new RegExp(INSTALL_COMMAND));
  });

  it("throws when the registered script file is missing", () => {
    writeHooksConfig({
      version: 1,
      hooks: {
        preToolUse: [hookEntry(STALE_SCRIPT_PATH), hookEntry(KILL_GUARD_PATH)],
      },
    });

    expect(() => validateHookRegistration(homeDir)).toThrow(
      /strip-cursor-attribution\.mjs is registered in hooks\.preToolUse but the script file is missing/,
    );
    expect(() => validateHookRegistration(homeDir)).toThrow(new RegExp(INSTALL_COMMAND));
  });

  it("throws when the entry is only at the top level and hooks is empty", () => {
    writeHooksConfig({
      version: 1,
      hooks: {},
      preToolUse: SCRIPT_PATHS.map(hookEntry),
    });

    expect(() => validateHookRegistration(homeDir)).toThrow(/not registered under hooks\.preToolUse/);
    expect(() => validateHookRegistration(homeDir)).toThrow(new RegExp(INSTALL_COMMAND));
  });
});
