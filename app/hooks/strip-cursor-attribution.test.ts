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
const PR_FOOTER = "Made with [Cursor](https://cursor.com)";

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
  it("removes --trailer with double quotes", () => {
    expect(
      stripCursorAttribution(
        `git commit --trailer "${CURSOR_TRAILER}" -m "x"`,
      ),
    ).toBe('git commit -m "x"');
  });

  it("removes --trailer with single quotes", () => {
    expect(
      stripCursorAttribution(
        `git commit --trailer '${CURSOR_TRAILER}' -m "x"`,
      ),
    ).toBe('git commit -m "x"');
  });

  it("removes --trailer= with double quotes", () => {
    expect(
      stripCursorAttribution(
        `git commit --trailer="${CURSOR_TRAILER}" -m "x"`,
      ),
    ).toBe('git commit -m "x"');
  });

  it("removes --trailer= with single quotes", () => {
    expect(
      stripCursorAttribution(
        `git commit --trailer='${CURSOR_TRAILER}' -m "x"`,
      ),
    ).toBe('git commit -m "x"');
  });

  it("removes unquoted --trailer=", () => {
    expect(
      stripCursorAttribution(
        "git commit --trailer=cursoragent@cursor.com -m x",
      ),
    ).toBe("git commit -m x");
  });

  it("leaves a --trailer for a different address", () => {
    expect(
      stripCursorAttribution(
        `git commit --trailer "${OTHER_TRAILER}" -m "x"`,
      ),
    ).toBeNull();
  });

  it("returns null when there is no trailer", () => {
    expect(stripCursorAttribution('git commit -m "x"')).toBeNull();
  });

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

  it("removes trailing Made-with-Cursor footer from quoted --body", () => {
    expect(
      stripCursorAttribution(
        `gh pr create --title "t" --body "## Summary\n\nHello\n\n${PR_FOOTER}"`,
      ),
    ).toBe('gh pr create --title "t" --body "## Summary\n\nHello"');
  });

  it("removes footer after literal \\n\\n escapes in a one-line --body", () => {
    expect(
      stripCursorAttribution(
        'gh pr create --title "t" --body "## Summary\\n\\nHello\\n\\n' +
          PR_FOOTER +
          '"',
      ),
    ).toBe('gh pr create --title "t" --body "## Summary\\n\\nHello"');
  });

  it("removes trailing Made-with-Cursor footer from HEREDOC --body", () => {
    const input = `gh pr create --draft --title "t" --body "$(cat <<'EOF'
## Summary

Hello

${PR_FOOTER}
EOF
)"`;
    const expected = `gh pr create --draft --title "t" --body "$(cat <<'EOF'
## Summary

Hello
EOF
)"`;
    expect(stripCursorAttribution(input)).toBe(expected);
  });

  it("returns null when gh pr create body does not end with the footer", () => {
    expect(
      stripCursorAttribution(
        `gh pr create --title "t" --body "## Summary\n\nHello"`,
      ),
    ).toBeNull();
  });

  it("leaves --body-file commands untouched", () => {
    expect(
      stripCursorAttribution(
        `gh pr create --title "t" --body-file /tmp/pr.md`,
      ),
    ).toBeNull();
  });

  it("applies both trailer and PR-footer transforms in one pass", () => {
    const input = `git commit --trailer "${CURSOR_TRAILER}" -m "x" && gh pr create --title "t" --body "$(cat <<'EOF'
## Summary

Hello

${PR_FOOTER}
EOF
)"`;
    const expected = `git commit -m "x" && gh pr create --title "t" --body "$(cat <<'EOF'
## Summary

Hello
EOF
)"`;
    expect(stripCursorAttribution(input)).toBe(expected);
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

  it("also accepts input.command when tool_input is absent", () => {
    const { stdout, status } = runHook(
      JSON.stringify({
        input: {
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

  it("prints allow with no updated_input for a non-matching payload", () => {
    const { stdout, status } = runHook(
      JSON.stringify({ tool_input: { command: 'git commit -m "x"' } }),
    );
    expect(status).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ permission: "allow" });
  });

  it("prints allow and exits 0 on malformed JSON", () => {
    const { stdout, status } = runHook("{not-json");
    expect(status).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ permission: "allow" });
  });

  it("prints allow and exits 0 when tool_input.command is absent", () => {
    const { stdout, status } = runHook(JSON.stringify({ tool_input: {} }));
    expect(status).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ permission: "allow" });
  });

  it("prints allow and exits 0 when tool_input.command is not a string", () => {
    const { stdout, status } = runHook(
      JSON.stringify({ tool_input: { command: 42 } }),
    );
    expect(status).toBe(0);
    expect(JSON.parse(stdout)).toEqual({ permission: "allow" });
  });
});
