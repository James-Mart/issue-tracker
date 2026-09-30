#!/usr/bin/env -S npx tsx
/**
 * Copy the default issue-tracker store into a guest data directory.
 *
 * Usage: npm run copy-guest-store -- --into <dir>
 */

import {
  copyGuestStore,
  formatCopyGuestStoreResult,
} from "../server/services/copy-guest-store.js";

function usage(): string {
  return `Usage: npm run copy-guest-store -- --into <dir>

Copy the default store beside this checkout into <dir>. <dir> must resolve
under AGENT_STACK_DATA_DIR and must not already hold a store.
`;
}

function parseArgs(argv: string[]): { into: string } {
  let into: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--into") {
      into = argv[i + 1];
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (!into) throw new Error("Missing required --into <dir>");
  return { into };
}

async function main(): Promise<void> {
  let into: string;
  try {
    ({ into } = parseArgs(process.argv.slice(2)));
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : err}\n\n${usage()}`);
    process.exit(1);
  }

  try {
    const result = copyGuestStore({ into });
    process.stdout.write(`${formatCopyGuestStoreResult(result)}\n`);
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : err}\n`);
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
