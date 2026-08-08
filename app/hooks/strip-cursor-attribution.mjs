// Plain JavaScript (not TypeScript): the hook is spawned by `node` directly for
// every shell tool call, and routing it through `tsx` would add hundreds of
// milliseconds to every command any agent or human runs on this machine.
// Everything else in the repo stays TypeScript.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Matches --trailer args whose value contains cursoragent@cursor.com. */
const CURSOR_TRAILER =
  /(?:^|\s)(--trailer(?:\s+(?:"[^"]*cursoragent@cursor\.com[^"]*"|'[^']*cursoragent@cursor\.com[^']*')|=(?:"[^"]*cursoragent@cursor\.com[^"]*"|'[^']*cursoragent@cursor\.com[^']*'|\S*cursoragent@cursor\.com\S*)))/g;

/** Exact Made-with-Cursor footer Cursor appends to agent PR bodies. */
const PR_FOOTER = "Made with [Cursor](https://cursor.com)";

/**
 * Remove Cursor attribution `--trailer` arguments from a shell command.
 * @param {string} command
 * @returns {string | null} rewritten command, or null when nothing matched
 */
function stripCursorTrailers(command) {
  CURSOR_TRAILER.lastIndex = 0;
  let matched = false;
  const rewritten = command.replace(CURSOR_TRAILER, () => {
    matched = true;
    return "";
  });
  if (!matched) return null;
  // Collapse doubled spaces from removals on single-line commands only —
  // multiline payloads (HEREDOC bodies) must keep their interior spacing.
  if (command.includes("\n")) return rewritten;
  return rewritten.replace(/ {2,}/g, " ").trim();
}

/**
 * Strip a trailing Made-with-Cursor footer (and a preceding blank line) from
 * PR body text. Optional single trailing newline after the footer is accepted
 * (HEREDOC line ending) and not re-added — callers that need a newline before
 * a HEREDOC delimiter add it when reconstructing.
 * @param {string} body
 * @returns {string | null}
 */
function stripFooterText(body) {
  let working = body;
  if (working.endsWith("\n") && working.slice(0, -1).endsWith(PR_FOOTER)) {
    working = working.slice(0, -1);
  }
  if (!working.endsWith(PR_FOOTER)) return null;
  let stripped = working.slice(0, -PR_FOOTER.length);
  // Real blank line (HEREDOC / multiline) or `\n\n` escapes in a one-line --body.
  if (stripped.endsWith("\n\n")) stripped = stripped.slice(0, -2);
  else if (stripped.endsWith("\\n\\n")) stripped = stripped.slice(0, -4);
  return stripped;
}

/**
 * Parse a `--body` argument at `start` (index of the opening quote or word).
 * Supports single-quoted, double-quoted, and `"$(cat <<…)"` HEREDOC forms.
 * @param {string} command
 * @param {number} start
 * @returns {{ end: number, rebuild: (body: string) => string, body: string } | null}
 */
function parseBodyArg(command, start) {
  if (start >= command.length) return null;
  const ch = command[start];

  if (ch === "'") {
    const end = command.indexOf("'", start + 1);
    if (end === -1) return null;
    return {
      body: command.slice(start + 1, end),
      end: end + 1,
      rebuild: (body) => `'${body}'`,
    };
  }

  if (ch === '"') {
    const heredoc = command
      .slice(start)
      .match(
        /^"\$\(\s*cat\s+<<(?:'(\w+)'|"(\w+)"|(\w+))\n([\s\S]*?)\n(\w+)\n\)"/,
      );
    if (heredoc) {
      const openWord = heredoc[1] || heredoc[2] || heredoc[3];
      const closeWord = heredoc[5];
      if (openWord === closeWord) {
        const delimOpen = heredoc[1]
          ? `'${openWord}'`
          : heredoc[2]
            ? `"${openWord}"`
            : openWord;
        return {
          body: heredoc[4],
          end: start + heredoc[0].length,
          rebuild: (body) =>
            `"$(cat <<${delimOpen}\n${body}\n${closeWord}\n)"`,
        };
      }
    }

    let i = start + 1;
    let body = "";
    while (i < command.length) {
      const c = command[i];
      if (c === "\\") {
        if (i + 1 >= command.length) return null;
        body += c + command[i + 1];
        i += 2;
        continue;
      }
      if (c === '"') {
        return {
          body,
          end: i + 1,
          rebuild: (next) => `"${next}"`,
        };
      }
      body += c;
      i++;
    }
    return null;
  }

  return null;
}

/**
 * Remove the trailing Made-with-Cursor footer from `gh pr create --body` /
 * HEREDOC bodies. Leaves `--body-file` alone.
 * @param {string} command
 * @returns {string | null}
 */
function stripPrAttribution(command) {
  if (!/\bgh\s+pr\s+create\b/.test(command)) return null;

  const flagRe = /(?:^|\s)--body(?:\s+|=)/g;
  let flagMatch;
  while ((flagMatch = flagRe.exec(command)) !== null) {
    const valueStart = flagMatch.index + flagMatch[0].length;
    const parsed = parseBodyArg(command, valueStart);
    if (parsed == null) continue;
    const stripped = stripFooterText(parsed.body);
    if (stripped === null) {
      // Advance past this arg and keep looking (unusual second --body).
      flagRe.lastIndex = parsed.end;
      continue;
    }
    return (
      command.slice(0, valueStart) +
      parsed.rebuild(stripped) +
      command.slice(parsed.end)
    );
  }
  return null;
}

/**
 * Remove Cursor attribution from a shell command: commit `--trailer` args
 * and/or a trailing Made-with-Cursor footer in `gh pr create --body`.
 * @param {string} command
 * @returns {string | null} rewritten command, or null when neither matched
 */
export function stripCursorAttribution(command) {
  const afterTrailers = stripCursorTrailers(command);
  const base = afterTrailers ?? command;
  const afterPr = stripPrAttribution(base);
  if (afterTrailers === null && afterPr === null) return null;
  return afterPr ?? afterTrailers;
}

/**
 * Prefer the live preToolUse field (`tool_input.command`); also accept
 * `input.command` so older/alternate shapes keep working.
 * @param {unknown} payload
 * @returns {string | undefined}
 */
function commandFromPayload(payload) {
  if (payload == null || typeof payload !== "object") return undefined;
  const record = /** @type {Record<string, unknown>} */ (payload);
  for (const key of ["tool_input", "input"]) {
    const nested = record[key];
    if (nested != null && typeof nested === "object") {
      const command = /** @type {Record<string, unknown>} */ (nested).command;
      if (typeof command === "string") return command;
    }
  }
  return undefined;
}

function printAllow(updatedCommand) {
  if (typeof updatedCommand === "string") {
    process.stdout.write(
      JSON.stringify({
        permission: "allow",
        updated_input: { command: updatedCommand },
      }),
    );
    return;
  }
  process.stdout.write(JSON.stringify({ permission: "allow" }));
}

function runAsHook() {
  try {
    const payload = JSON.parse(readFileSync(0, "utf8"));
    const command = commandFromPayload(payload);
    if (typeof command !== "string") {
      printAllow(null);
      return;
    }
    printAllow(stripCursorAttribution(command));
  } catch {
    printAllow(null);
  }
}

const isMain =
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  runAsHook();
}
