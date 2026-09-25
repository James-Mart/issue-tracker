import type { Issue } from "../schemas.js";
import { agentSdk, type AgentSdk } from "./agent-sdk.js";
import { readAll } from "./issues.js";

export type PrewarmRelease = () => Promise<void>;

/**
 * Prewarm each Project workspace that is already set. A failure is logged
 * with the workspace path and does not block the rest of boot; the first
 * `send()` against that workspace does the work instead. Workspaces set
 * later are not prewarmed.
 */
export async function prewarmProjectWorkspaces(
  sdk: AgentSdk = agentSdk,
): Promise<PrewarmRelease[]> {
  const releases: PrewarmRelease[] = [];
  for (const issue of readAll().issues) {
    if (issue.kind !== "project") continue;
    const workspace = projectWorkspace(issue);
    if (workspace === undefined) continue;
    try {
      releases.push(await sdk.prewarmWorkspace(workspace));
    } catch (err) {
      console.error(`prewarm failed for workspace ${workspace}`, err);
    }
  }
  return releases;
}

/** Call every release. A thrown release is kept until the rest have run. */
export async function releasePrewarmedWorkspaces(
  releases: readonly PrewarmRelease[],
): Promise<void> {
  const failures: unknown[] = [];
  for (const release of releases) {
    try {
      await release();
    } catch (err) {
      failures.push(err);
    }
  }
  if (failures.length > 0) {
    throw failures[0];
  }
}

/**
 * Agent sessions dispose first so in-flight runs finish against the warmed
 * executor; the prewarm leases are released after that.
 */
export async function disposeSessionsAndReleasePrewarm(
  disposeAll: () => Promise<void>,
  releases: readonly PrewarmRelease[],
): Promise<void> {
  await disposeAll();
  await releasePrewarmedWorkspaces(releases);
}

function projectWorkspace(
  issue: Extract<Issue, { kind: "project" }>,
): string | undefined {
  const workspace = issue.workspace?.trim();
  if (!workspace) return undefined;
  return workspace;
}
