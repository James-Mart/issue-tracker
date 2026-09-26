#!/usr/bin/env -S npx tsx
/**
 * Start or stop a conversation's agent verification stack.
 *
 * Usage: npm run agent-stack -- start|stop <conversationId> [<issueId>]
 */

import {
  agentStackStatePath,
  startAgentStack,
  stopAgentStack,
} from "../server/services/agent-stack.js";

function usage(): string {
  return `Usage: npm run agent-stack -- start|stop <conversationId> [<issueId>]

start  Start (or adopt) the conversation's stack for <issueId>'s Story worktree
       and print AGENT_STACK_PORT, AGENT_STACK_AUX_PORT, AGENT_STACK_DATA_DIR,
       and AGENT_STACK_BASE_URL on stdout. Reuses the live stack only when its
       recorded worktree matches.
stop   Stop the conversation's stack, remove its data directory, and clear state.
`;
}

async function main(): Promise<void> {
  const [command, conversationId, issueId, ...rest] = process.argv.slice(2);

  if (!command || !conversationId || rest.length > 0) {
    process.stderr.write(usage());
    process.exit(1);
  }

  if (command === "start") {
    if (!issueId) {
      process.stderr.write(usage());
      process.exit(1);
    }
    const { state, env, reused, memoryLimitFailures } = await startAgentStack(
      conversationId,
      { issueId },
    );
    for (const line of memoryLimitFailures) {
      process.stderr.write(`${line}\n`);
    }
    for (const [key, value] of Object.entries(env)) {
      process.stdout.write(`${key}=${value}\n`);
    }
    process.stderr.write(
      `${reused ? "reused" : "started"} agent stack for ${conversationId} ` +
        `(state: ${agentStackStatePath(state.conversationId)})\n`,
    );
    return;
  }

  if (command === "stop") {
    const result = await stopAgentStack(conversationId);
    for (const line of result.memoryLimitFailures) {
      process.stderr.write(`${line}\n`);
    }
    process.stderr.write(
      result.stopped
        ? `stopped agent stack for ${conversationId} (freed ports ${result.state.port}, ${result.state.auxPort})\n`
        : `no agent stack recorded for ${conversationId}\n`,
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
