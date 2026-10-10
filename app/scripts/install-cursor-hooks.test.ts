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
  it("preserves unrelated preToolUse entries and other hook events", () => {
    const otherPreToolUse = {
      type: "command" as const,
      command: "node /other/hook.mjs",
      matcher: "Shell",
    };
    const postToolUse = [{ type: "command", command: "echo done", matcher: "Shell" }];
    const config = {
      version: 2,
      hooks: {
        preToolUse: [otherPreToolUse, entry(STALE_SCRIPT_PATH)],
        postToolUse,
      },
      custom: { keep: true },
    };

    expect(ensureHookRegistration(config, SCRIPT_PATH)).toEqual({
      version: 1,
      hooks: {
        preToolUse: [otherPreToolUse, entry(SCRIPT_PATH)],
        postToolUse,
      },
      custom: { keep: true },
    });
  });
});
