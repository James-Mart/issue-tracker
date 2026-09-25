#!/usr/bin/env -S npx tsx
/**
 * Print one Open live Storybook markdown link per mockup direction.
 *
 * Usage: npm run mockup-live-links -- --conversation <id> [--direction <id>...]
 */

import { listLiveStorybookLinks } from "../server/services/mockup-live-storybook.js";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export interface MockupLiveLinksCliOptions {
  conversationId: string;
  directionIds: string[];
}

function usage(): string {
  return `Usage: npm run mockup-live-links -- --conversation <id> [--direction <id>...]

Print one [Open live Storybook](...) markdown line per direction on stdout.
When --direction is omitted, every direction in the conversation scratch is
included in sorted order.

Options:
  --conversation <id>   Conversation whose live mockup stack supplies index.json
  --direction <id>      Direction to include (repeatable; default: all directions)
`;
}

export function parseArgs(argv: string[]): MockupLiveLinksCliOptions {
  let conversationId: string | undefined;
  const directionIds: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--conversation") {
      const value = argv[++i];
      if (!value) throw new Error("--conversation requires a value");
      conversationId = value;
    } else if (arg === "--direction") {
      const value = argv[++i];
      if (!value) throw new Error("--direction requires a value");
      directionIds.push(value);
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

  return { conversationId, directionIds };
}

async function main(): Promise<void> {
  const { conversationId, directionIds } = parseArgs(process.argv.slice(2));
  const links = await listLiveStorybookLinks(
    conversationId,
    directionIds.length > 0 ? directionIds : undefined,
  );
  for (const link of links) {
    process.stdout.write(`${link.markdown}\n`);
  }
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
