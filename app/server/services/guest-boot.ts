import { realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import { issuesDir, trackerGuest } from "../config.js";

export const AGENT_STACK_DATA_DIR_ENV = "AGENT_STACK_DATA_DIR";

/** Real path, or undefined when the path is absent (ENOENT / ENOTDIR). */
function realPath(path: string): string | undefined {
  try {
    return realpathSync(resolve(path));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return undefined;
    throw err;
  }
}

function named(label: string, path: string, missing: boolean): string {
  return missing ? `${label} ${path} is missing` : `${label} ${path}`;
}

/**
 * Refusal message naming both paths, or undefined when this process may open
 * the store. Guest off always continues. Guest on requires the real
 * `ISSUES_DIR` to sit strictly inside the real `AGENT_STACK_DATA_DIR`.
 */
function guestBootRefusal(): string | undefined {
  if (!trackerGuest) return undefined;
  const issuesReal = realPath(issuesDir);
  // Unset has no data-dir path. Name the issues path we would have compared:
  // its real path when that directory exists, otherwise the configured path.
  const issuesShown = issuesReal ?? resolve(issuesDir);
  const dataConfigured = process.env[AGENT_STACK_DATA_DIR_ENV];
  if (!dataConfigured) {
    return `guest boot refused: ISSUES_DIR ${issuesShown} is not under AGENT_STACK_DATA_DIR unset`;
  }
  const dataReal = realPath(dataConfigured);
  if (!issuesReal || !dataReal) {
    const dataShown = dataReal ?? resolve(dataConfigured);
    return `guest boot refused: ${named("ISSUES_DIR", issuesShown, !issuesReal)}; ${named("AGENT_STACK_DATA_DIR", dataShown, !dataReal)}`;
  }
  if (issuesReal === dataReal || !issuesReal.startsWith(dataReal + sep)) {
    return `guest boot refused: ISSUES_DIR ${issuesReal} is not under AGENT_STACK_DATA_DIR ${dataReal}`;
  }
  return undefined;
}

/** Exit at boot when a guest would open a store outside its data dir. */
export function assertGuestBoot(): void {
  const message = guestBootRefusal();
  if (!message) return;
  console.error(message);
  process.exit(1);
}
