#!/usr/bin/env -S npx tsx
/**
 * Drive an outline's replay bundles, replay tree, and Storybook.
 *
 * Usage: npm run outline-mockups -- <command> <args...>
 */

import { AUTHOR_RUN_STATES, type AuthorRunState } from "../server/services/outline-mockup-store.js";
import { captureOutlineDirections } from "../server/services/outline-captures.js";
import {
  acceptOutlineDirection,
  authorWorkspace,
  dropOutlineDirection,
  listAcceptedDirections,
  noteAuthorRun,
  packOutlineTree,
  restoreOutlineTree,
} from "../server/services/outline-replay-tree.js";
import {
  acquireViewerLease,
  bindMockupSession,
  releaseLease,
} from "../server/services/outline-storybook.js";

function usage(): string {
  return `Usage: npm run outline-mockups -- <command> <args...>

directions <outlineId>
       Print each accepted direction id, one per line.
restore <outlineId>
       Restore every accepted direction's stories and the shared harness.json
       and package.json into the replay tree, then install.
pack <outlineId>
       Overwrite every accepted direction's bundle from the replay tree.
       With an unpublished draft or an append planner lock, also pack every
       direction in the tree, and save a one-time backup of each bundle that
       predated the draft.
workspace <outlineId> <conversationId>
       Print the directory the mockup author writes. The replay tree when
       the outline holds bundles, and the planning scratch otherwise.
drop <outlineId> <directionId>
       Remove that direction's live bundle and delete its stories from the
       replay tree. harness.json, package.json, and other directions stay.
accept <outlineId> <directionId> <issueId>
       Save that direction's bundle from the replay tree. An accepted
       direction, or a direction accepted onto the outline, is written on
       the outline. A new direction is attached to the issue.
author-run <outlineId> running|failed|clean
       Record the mockup author's run state.
bind <outlineId> <conversationId>
       Serve the outline's Storybook at /mockups/<conversationId>/.
view <outlineId>
       Hold the viewer lease, starting Storybook when down. Prints the lease
       id, then the public path.
capture <outlineId> [--from-pack]
       Capture phone and desktop PNGs of every accepted direction under a
       capture lease and print one PNG path per line. --from-pack restores
       the packed bundles first.
release <leaseId>
       End a lease. Storybook stops when no lease is left.
`;
}

function fail(message: string): never {
  process.stderr.write(message.endsWith("\n") ? message : `${message}\n`);
  process.exit(1);
}

function authorRunState(value: string | undefined): AuthorRunState {
  const state = AUTHOR_RUN_STATES.find((candidate) => candidate === value);
  if (!state) fail(`author-run state must be running, failed, or clean\n\n${usage()}`);
  return state;
}

function expectArgs(args: string[], count: number): string[] {
  if (args.length !== count || args.some((arg) => !arg)) fail(usage());
  return args;
}

function printLines(lines: string[]): void {
  if (lines.length > 0) process.stdout.write(`${lines.join("\n")}\n`);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case "directions": {
      const [outlineId] = expectArgs(args, 1);
      printLines(listAcceptedDirections(outlineId!).map((entry) => entry.directionId));
      return;
    }
    case "restore": {
      const [outlineId] = expectArgs(args, 1);
      printLines((await restoreOutlineTree(outlineId!)).directionIds);
      return;
    }
    case "pack": {
      const [outlineId] = expectArgs(args, 1);
      printLines((await packOutlineTree(outlineId!)).directionIds);
      return;
    }
    case "workspace": {
      const [outlineId, conversationId] = expectArgs(args, 2);
      printLines([authorWorkspace(outlineId!, conversationId!)]);
      return;
    }
    case "drop": {
      const [outlineId, directionId] = expectArgs(args, 2);
      await dropOutlineDirection(outlineId!, directionId!);
      printLines([directionId!]);
      return;
    }
    case "accept": {
      const [outlineId, directionId, issueId] = expectArgs(args, 3);
      await acceptOutlineDirection(outlineId!, directionId!, issueId!);
      printLines([directionId!]);
      return;
    }
    case "author-run": {
      const [outlineId, state] = expectArgs(args, 2);
      await noteAuthorRun(outlineId!, authorRunState(state));
      return;
    }
    case "bind": {
      const [outlineId, conversationId] = expectArgs(args, 2);
      await bindMockupSession(outlineId!, conversationId!);
      return;
    }
    case "view": {
      const [outlineId] = expectArgs(args, 1);
      const { leaseId, baseUrl } = await acquireViewerLease(outlineId!);
      printLines([leaseId, baseUrl]);
      return;
    }
    case "capture": {
      const fromPack = args.includes("--from-pack");
      const [outlineId] = expectArgs(
        args.filter((arg) => arg !== "--from-pack"),
        1,
      );
      const captures = await captureOutlineDirections(outlineId!, { fromPack });
      printLines(captures.map((capture) => capture.pngPath));
      return;
    }
    case "release": {
      const [leaseId] = expectArgs(args, 1);
      await releaseLease(leaseId!);
      return;
    }
    default:
      fail(command ? `Unknown command: ${command}\n\n${usage()}` : usage());
  }
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
});
