#!/usr/bin/env -S npx tsx
/**
 * Resolve a mockup conversation id or agent id to the conversation directory name.
 *
 * Usage: npm run mockup-resolve -- <id>
 */

import { resolveMockupConversationId } from "../server/services/mockup-scratch.js";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export interface MockupResolveCliOptions {
  conversationId: string;
}

function usage(): string {
  return `Usage: npm run mockup-resolve -- <id>

Print the conversation directory name used for mockup scratch paths.
Accepts a conversation directory name or a meta.json agentId.
`;
}

export function parseArgs(argv: string[]): MockupResolveCliOptions {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(usage());
    process.exit(0);
  }
  const conversationId = argv[0];
  if (!conversationId) {
    throw new Error("conversation id or agent id is required");
  }
  if (argv.length > 1) {
    throw new Error(`Unexpected argument: ${argv[1]}`);
  }
  return { conversationId };
}

function main(): void {
  const { conversationId } = parseArgs(process.argv.slice(2));
  process.stdout.write(`${resolveMockupConversationId(conversationId)}\n`);
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
