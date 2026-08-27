#!/usr/bin/env -S npx tsx
/**
 * Remove the mockup directions a stakeholder did not choose.
 *
 * Usage: npm run mockup-prune -- --conversation <id> --keep <directionId>
 */

import { pruneDirections } from "../server/services/mockup-scratch.js";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export interface MockupPruneCliOptions {
  conversationId: string;
  keepDirectionId: string;
}

function usage(): string {
  return `Usage: npm run mockup-prune -- --conversation <id> --keep <directionId>

Remove every direction in the conversation's mockup scratch except the one
kept, and print one removed direction id per line on stdout.

Options:
  --conversation <id>   Conversation whose mockup scratch holds the directions
  --keep <directionId>  Direction the stakeholder chose
`;
}

export function parseArgs(argv: string[]): MockupPruneCliOptions {
  let conversationId: string | undefined;
  let keepDirectionId: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--conversation") {
      const value = argv[++i];
      if (!value) throw new Error("--conversation requires a value");
      conversationId = value;
    } else if (arg === "--keep") {
      const value = argv[++i];
      if (!value) throw new Error("--keep requires a value");
      keepDirectionId = value;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(usage());
      process.exit(0);
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  if (!conversationId) throw new Error("--conversation is required");
  if (!keepDirectionId) throw new Error("--keep is required");

  return { conversationId, keepDirectionId };
}

function main(): void {
  const { conversationId, keepDirectionId } = parseArgs(process.argv.slice(2));
  for (const removed of pruneDirections(conversationId, keepDirectionId)) {
    process.stdout.write(`${removed}\n`);
  }
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
