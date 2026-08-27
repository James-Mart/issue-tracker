#!/usr/bin/env -S npx tsx
/**
 * Capture Storybook mockup PNGs from a running harness stack.
 *
 * Usage: npm run mockup-capture -- --conversation <id> [options]
 */

import {
  captureMockupStories,
  parseViewports,
  type MockupCaptureOptions,
} from "../server/services/mockup-capture.js";
import type { ViewportName } from "../server/services/mockup-story-capture.js";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export interface MockupCaptureCliOptions {
  conversationId: string;
  directionId?: string;
  viewports: ViewportName[];
  baseUrl?: string;
}

function usage(): string {
  return `Usage: npm run mockup-capture -- --conversation <id> [options]

Capture Storybook states from a running mockup stack into the conversation's
mockup scratch and print one absolute path per line on stdout.

Options:
  --conversation <id>   Conversation whose mockup scratch holds the harness
  --direction <id>      Capture only stories titled <id>/...
  --viewports <list>    phone or phone,desktop (default phone,desktop)
  --base-url <url>      Storybook base URL (default: live stack for conversation)
`;
}

export function parseArgs(argv: string[]): MockupCaptureCliOptions {
  let conversationId: string | undefined;
  let directionId: string | undefined;
  let viewports: ViewportName[] = ["phone", "desktop"];
  let baseUrl: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--conversation") {
      const value = argv[++i];
      if (!value) throw new Error("--conversation requires a value");
      conversationId = value;
    } else if (arg === "--direction") {
      const value = argv[++i];
      if (!value) throw new Error("--direction requires a value");
      directionId = value;
    } else if (arg === "--viewports") {
      const value = argv[++i];
      if (!value) throw new Error("--viewports requires a value");
      viewports = parseViewports(value);
    } else if (arg === "--base-url") {
      const value = argv[++i];
      if (!value) throw new Error("--base-url requires a value");
      baseUrl = value.replace(/\/$/, "");
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(usage());
      process.exit(0);
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  if (!conversationId) {
    throw new Error("--conversation is required");
  }

  return { conversationId, directionId, viewports, baseUrl };
}

async function main(): Promise<void> {
  const options: MockupCaptureOptions = parseArgs(process.argv.slice(2));
  const paths = await captureMockupStories(options);
  for (const path of paths) {
    process.stdout.write(`${path}\n`);
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
