import type { Runtime } from "../schemas.js";
import { loadPhaseSecrets } from "./agent-stack-secrets.js";
import { readAll } from "./issues.js";
import { ancestorChain } from "./subtree.js";
import {
  isStackLive,
  readAgentStackState,
  runAgentStackShell,
} from "./agent-stack.js";

// Type aliases, not interfaces: only aliases get the implicit index
// signature that makes these assignable to the SDK's `SDKJsonValue` result.
export type AgentStackPhaseResult = {
  exitStatus: number;
  output: string;
};

/** `ran: false` means `redeploy` is unset and nothing was executed. */
export type AgentStackRedeployResult =
  | { ran: false; message: string }
  | {
      ran: true;
      redeploy: AgentStackPhaseResult;
      readiness?: AgentStackPhaseResult;
    };

const HOT_RELOAD_MESSAGE = "the runtime hot-reloads";

function projectRuntime(issueId: string): { projectId: string; runtime: Runtime | undefined } {
  const { issues } = readAll();
  const project = ancestorChain(issueId, issues)[0]!;
  if (project.kind !== "project") {
    throw new Error(`issue "${issueId}" is not under a project`);
  }
  return { projectId: project.id, runtime: project.runtime };
}

/**
 * Run the live stack's `redeploy` phase in its worktree with the stack
 * environment and Project secrets, then re-run `readiness`. Refuses when
 * this conversation has no live stack. An empty `redeploy` runs nothing.
 */
export async function redeployAgentStack(
  conversationId: string,
): Promise<AgentStackRedeployResult> {
  const state = readAgentStackState(conversationId);
  if (!state || !isStackLive(state)) {
    throw new Error(
      "agent_stack_redeploy: this conversation has no live stack",
    );
  }
  const { projectId, runtime } = projectRuntime(state.issueId);
  if (!runtime?.redeploy) {
    return { ran: false, message: HOT_RELOAD_MESSAGE };
  }
  const secrets = loadPhaseSecrets(projectId);
  const redeploy = await runAgentStackShell(
    runtime.redeploy,
    state.worktree,
    state,
    secrets,
  );
  if (redeploy.exitStatus !== 0 || !runtime.readiness) {
    return { ran: true, redeploy };
  }
  const readiness = await runAgentStackShell(
    runtime.readiness,
    state.worktree,
    state,
    secrets,
  );
  return { ran: true, redeploy, readiness };
}
