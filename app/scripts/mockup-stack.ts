#!/usr/bin/env -S npx tsx
/**
 * Start or stop a conversation's Storybook mockup stack.
 *
 * Usage: npm run mockup-stack -- start|stop <conversationId>
 */

import { mockupStackStatePath } from "../server/services/mockup-scratch.js";
import {
  startMockupStack,
  stopMockupStack,
} from "../server/services/mockup-stack.js";

function usage(): string {
  return `Usage: npm run mockup-stack -- start|stop <conversationId>

start  Start (or adopt) the conversation's Storybook stack on a free port and
       print its base URL on stdout.
stop   Stop the conversation's Storybook stack and clear its durable state.
`;
}

async function main(): Promise<void> {
  const [command, conversationId, ...rest] = process.argv.slice(2);

  if (!command || !conversationId || rest.length > 0) {
    process.stderr.write(usage());
    process.exit(1);
  }

  if (command === "start") {
    const { state, reused } = await startMockupStack(conversationId);
    process.stdout.write(`${state.baseUrl}\n`);
    process.stderr.write(
      `${reused ? "reused" : "started"} mockup stack for ${conversationId} ` +
        `(state: ${mockupStackStatePath(conversationId)})\n`,
    );
    return;
  }

  if (command === "stop") {
    const result = await stopMockupStack(conversationId);
    process.stderr.write(
      result.stopped
        ? `stopped mockup stack for ${conversationId} (freed port ${result.state.port})\n`
        : `no mockup stack recorded for ${conversationId}\n`,
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
