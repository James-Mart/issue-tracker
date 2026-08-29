#!/usr/bin/env -S npx tsx
/**
 * Attach, finalize, or copy mockup direction artifacts on an issue.
 *
 * Usage: npm run mockup-promote -- --direction <id> --issue <issueId> --mode <mode> [options]
 */

import {
  promoteMockup,
  type PromoteMode,
  type PromoteOptions,
} from "../server/services/mockup-promote.js";
import { resolveMockupConversationId } from "../server/services/mockup-scratch.js";
import { attachmentsApiPath } from "../src/features/issues/lib/attachments.js";
import { conversationAttachmentApiPath } from "../src/features/agents/api/client.js";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export interface MockupPromoteCliOptions extends PromoteOptions {}

function usage(): string {
  return `Usage: npm run mockup-promote -- --direction <id> --issue <issueId> --mode <mode> [options]

Attach mockup captures (and, for chosen, an archive) to an issue, or copy a
chosen direction's artifacts from one issue to another.

Modes:
  candidate  Capture both viewports and attach as mockup-candidate-...
  chosen     Capture both viewports, attach PNGs plus archive, replace that
             direction's prior chosen set, detach candidates
  copy       Copy chosen PNGs and archive from --from-issue (no stack)

Options:
  --direction <id>      Direction to promote
  --issue <issueId>     Issue that receives the artifacts
  --mode <mode>         candidate | chosen | copy
  --conversation <id>   Conversation whose stack renders captures (candidate, chosen)
  --from-issue <id>     Issue to copy chosen artifacts from (copy)
`;
}

const MODES: PromoteMode[] = ["candidate", "chosen", "copy"];

function parseMode(value: string): PromoteMode {
  if (!MODES.includes(value as PromoteMode)) {
    throw new Error(
      `--mode must be candidate, chosen, or copy, got ${JSON.stringify(value)}`,
    );
  }
  return value as PromoteMode;
}

export function parseArgs(argv: string[]): MockupPromoteCliOptions {
  let directionId: string | undefined;
  let issueId: string | undefined;
  let mode: PromoteMode | undefined;
  let conversationId: string | undefined;
  let fromIssueId: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--direction") {
      const value = argv[++i];
      if (!value) throw new Error("--direction requires a value");
      directionId = value;
    } else if (arg === "--issue") {
      const value = argv[++i];
      if (!value) throw new Error("--issue requires a value");
      issueId = value;
    } else if (arg === "--mode") {
      const value = argv[++i];
      if (!value) throw new Error("--mode requires a value");
      mode = parseMode(value);
    } else if (arg === "--conversation") {
      const value = argv[++i];
      if (!value) throw new Error("--conversation requires a value");
      conversationId = value;
    } else if (arg === "--from-issue") {
      const value = argv[++i];
      if (!value) throw new Error("--from-issue requires a value");
      fromIssueId = value;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(usage());
      process.exit(0);
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  if (!directionId) throw new Error("--direction is required");
  if (!mode) throw new Error("--mode is required");
  if (mode === "candidate") {
    if (issueId !== undefined) {
      throw new Error("--issue is not used with --mode candidate");
    }
  } else if (!issueId) {
    throw new Error("--issue is required");
  }

  return { mode, directionId, issueId, conversationId, fromIssueId };
}

export function attachmentEmbedMarkdown(issueId: string, name: string): string {
  return `![${name}](${attachmentsApiPath(issueId, name)})`;
}

export function conversationAttachmentEmbedMarkdown(
  conversationId: string,
  name: string,
): string {
  return `![${name}](${conversationAttachmentApiPath(conversationId, name)})`;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const result = await promoteMockup(options);
  const resolvedConversationId =
    options.mode === "candidate" && options.conversationId
      ? resolveMockupConversationId(options.conversationId)
      : undefined;
  for (const name of result.attached) {
    process.stdout.write(`${name}\n`);
  }
  for (const path of result.capturePaths) {
    process.stdout.write(`${path}\n`);
  }
  for (const name of result.attached) {
    if (!name.endsWith(".png")) continue;
    if (options.mode === "candidate") {
      process.stdout.write(
        `${conversationAttachmentEmbedMarkdown(resolvedConversationId!, name)}\n`,
      );
    } else {
      process.stdout.write(
        `${attachmentEmbedMarkdown(options.issueId!, name)}\n`,
      );
    }
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
