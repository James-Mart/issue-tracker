#!/usr/bin/env -S npx tsx
/**
 * Start or stop a conversation's Storybook mockup stack.
 *
 * Usage: npm run mockup-stack -- start|stop <conversationId>
 *        npm run mockup-stack -- stop --all
 */

import { mockupStackStatePath } from "../server/services/mockup-scratch.js";
import {
  startMockupStack,
  stopAllMockupStacks,
  stopMockupStack,
} from "../server/services/mockup-stack.js";

function usage(): string {
  return `Usage: npm run mockup-stack -- start|stop <conversationId>
       npm run mockup-stack -- stop --all

start  Start (or adopt) the conversation's Storybook stack on a free port and
       print its base URL on stdout.
stop   Stop the conversation's Storybook stack and clear its durable state.
stop --all
       Stop every recorded mockup stack and report each port freed.
`;
}

async function main(): Promise<void> {
  const [command, arg, ...rest] = process.argv.slice(2);

  if (!command || rest.length > 0) {
    process.stderr.write(usage());
    process.exit(1);
  }

  if (command === "start") {
    if (!arg) {
      process.stderr.write(usage());
      process.exit(1);
    }
    const { state, reused } = await startMockupStack(arg);
    process.stdout.write(`${state.baseUrl}\n`);
    process.stderr.write(
      `${reused ? "reused" : "started"} mockup stack for ${arg} ` +
        `(state: ${mockupStackStatePath(arg)})\n`,
    );
    return;
  }

  if (command === "stop") {
    if (arg === "--all") {
      const freed = await stopAllMockupStacks();
      if (freed.length === 0) {
        process.stderr.write("no mockup stacks recorded\n");
        return;
      }
      for (const { conversationId, port } of freed) {
        process.stderr.write(
          `stopped mockup stack for ${conversationId} (freed port ${port})\n`,
        );
      }
      return;
    }
    if (!arg) {
      process.stderr.write(usage());
      process.exit(1);
    }
    const result = await stopMockupStack(arg);
    process.stderr.write(
      result.stopped
        ? `stopped mockup stack for ${arg} (freed port ${result.state.port})\n`
        : `no mockup stack recorded for ${arg}\n`,
    );
    return;
  }

  process.stderr.write(`Unknown command: ${command}\n\n${usage()}`);
  process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
