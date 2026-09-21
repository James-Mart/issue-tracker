#!/usr/bin/env -S npx tsx
/**
 * Start or stop a conversation's agent verification stack.
 *
 * Usage: npm run agent-stack -- start|stop <conversationId> [<workspace>]
 */

import {
  agentStackStatePath,
  startAgentStack,
  stopAgentStack,
} from "../server/services/agent-stack.js";

function usage(): string {
  return `Usage: npm run agent-stack -- start|stop <conversationId> [<workspace>]

start  Start (or adopt) the conversation's API + Vite stack on free ports for
       <workspace> (absolute Project checkout path) and print its env contract
       on stdout. Reuses the live stack only when its recorded workspace matches.
stop   Stop the conversation's stack and clear its durable state.
`;
}

async function main(): Promise<void> {
  const [command, conversationId, workspace, ...rest] = process.argv.slice(2);

  if (!command || !conversationId || rest.length > 0) {
    process.stderr.write(usage());
    process.exit(1);
  }

  if (command === "start") {
    if (!workspace) {
      process.stderr.write(usage());
      process.exit(1);
    }
    const { state, env, reused } = await startAgentStack(conversationId, {
      workspace,
    });
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
    process.stderr.write(
      result.stopped
        ? `stopped agent stack for ${conversationId} (freed ports ${result.state.apiPort}, ${result.state.vitePort})\n`
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
