import { describe, expect, it } from "vitest";
import { ensureHookRegistration } from "./install-cursor-hooks.js";

const SCRIPT_PATH = "/work/issue-tracker/app/hooks/strip-cursor-attribution.mjs";
const STALE_SCRIPT_PATH =
  "/old/checkout/app/hooks/strip-cursor-attribution.mjs";

const entry = (scriptPath: string) => ({
  type: "command" as const,
  command: `node ${scriptPath}`,
  matcher: "Shell",
});

describe("ensureHookRegistration", () => {
  it("creates version 1 and preToolUse when config is undefined", () => {
    expect(ensureHookRegistration(undefined, SCRIPT_PATH)).toEqual({
      version: 1,
      preToolUse: [entry(SCRIPT_PATH)],
    });
  });

  it("creates version 1 and preToolUse when config is an empty object", () => {
    expect(ensureHookRegistration({}, SCRIPT_PATH)).toEqual({
      version: 1,
      preToolUse: [entry(SCRIPT_PATH)],
    });
  });

  it("does not duplicate an existing entry for the same script path", () => {
    const config = {
      version: 1,
      preToolUse: [entry(SCRIPT_PATH)],
    };

    expect(ensureHookRegistration(config, SCRIPT_PATH)).toEqual(config);
  });

  it("replaces a stale script path in place", () => {
    const config = {
      version: 1,
      preToolUse: [entry(STALE_SCRIPT_PATH)],
    };

    expect(ensureHookRegistration(config, SCRIPT_PATH)).toEqual({
      version: 1,
      preToolUse: [entry(SCRIPT_PATH)],
    });
  });

  it("preserves unrelated preToolUse entries and other hook events", () => {
    const otherPreToolUse = {
      type: "command" as const,
      command: "node /other/hook.mjs",
      matcher: "Shell",
    };
    const postToolUse = [{ type: "command", command: "echo done", matcher: "Shell" }];
    const config = {
      version: 2,
      preToolUse: [otherPreToolUse, entry(STALE_SCRIPT_PATH)],
      postToolUse,
      custom: { keep: true },
    };

    expect(ensureHookRegistration(config, SCRIPT_PATH)).toEqual({
      version: 1,
      preToolUse: [otherPreToolUse, entry(SCRIPT_PATH)],
      postToolUse,
      custom: { keep: true },
    });
  });
});
