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

/**
 * Remove Cursor attribution `--trailer` arguments from a shell command.
 * @param {string} command
 * @returns {string | null} rewritten command, or null when nothing matched
 */
export function stripCursorAttribution(command) {
  CURSOR_TRAILER.lastIndex = 0;
  let matched = false;
  const rewritten = command.replace(CURSOR_TRAILER, () => {
    matched = true;
    return "";
  });
  if (!matched) return null;
  return rewritten.replace(/ {2,}/g, " ").trim();
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
    const command = payload?.input?.command;
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
