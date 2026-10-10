import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { stripCursorAttribution } from "./strip-cursor-attribution.mjs";

const scriptPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "strip-cursor-attribution.mjs",
);

const CURSOR_TRAILER =
  'Co-authored-by: Cursor <cursoragent@cursor.com>';
const OTHER_TRAILER = "Co-authored-by: Ada <ada@example.com>";

function runHook(stdin: string): {
  stdout: string;
  stderr: string;
  status: number | null;
} {
  const result = spawnSync("node", [scriptPath], {
    input: stdin,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status,
  };
}

describe("stripCursorAttribution", () => {
  it("keeps a chained command and a -m message containing the word trailer", () => {
    expect(
      stripCursorAttribution(
        `git add -A && git commit --trailer "${CURSOR_TRAILER}" -m "add trailer support"`,
      ),
    ).toBe('git add -A && git commit -m "add trailer support"');
  });

  it("removes only Cursor trailers when mixed with others", () => {
    expect(
      stripCursorAttribution(
        `git commit --trailer "${OTHER_TRAILER}" --trailer "${CURSOR_TRAILER}" -m "x"`,
      ),
    ).toBe(`git commit --trailer "${OTHER_TRAILER}" -m "x"`);
  });
});

describe("strip-cursor-attribution.mjs stdout contract", () => {
  it("prints allow with updated_input.command for a matching tool_input payload", () => {
    const { stdout, status } = runHook(
      JSON.stringify({
        tool_input: {
          command: `git commit --trailer "${CURSOR_TRAILER}" -m "x"`,
        },
      }),
    );
    expect(status).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      permission: "allow",
      updated_input: { command: 'git commit -m "x"' },
    });
  });
});
