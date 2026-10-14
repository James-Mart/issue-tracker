#!/usr/bin/env -S npx tsx
/**
 * Install target-declared packages into a conversation's mockup sandbox.
 *
 * Usage: npm run mockup-deps -- <conversationId> --from <target path> <package...>
 */

import { installSandboxPackages } from "../server/services/mockup-sandbox.js";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export interface MockupDepsCliOptions {
  conversationId: string;
  from: string;
  packages: string[];
}

function usage(): string {
  return `Usage: npm run mockup-deps -- <conversationId> --from <target path> <package...>

Install target-declared packages into the conversation's mockup sandbox and
print one name@range line per installed package.

Each package's range comes from the nearest package.json at or above --from
that declares it in dependencies, devDependencies, or peerDependencies.

Options:
  --from <path>   Target file or directory. Required.
`;
}

export function parseArgs(argv: string[]): MockupDepsCliOptions {
  let from: string | undefined;
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--from") {
      const value = argv[++i];
      if (!value) throw new Error("--from requires a value");
      from = value;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(usage());
      process.exit(0);
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positionals.push(arg);
    }
  }

  const conversationId = positionals[0];
  if (!conversationId) throw new Error("conversation id is required");
  if (!from) throw new Error("--from is required");

  return { conversationId, from, packages: positionals.slice(1) };
}

function main(): void {
  const { conversationId, from, packages } = parseArgs(process.argv.slice(2));
  const { installed } = installSandboxPackages({ conversationId, from, packages });
  for (const pkg of installed) {
    process.stdout.write(`${pkg.name}@${pkg.range}\n`);
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
