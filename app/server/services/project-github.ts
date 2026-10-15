import type { Issue } from "../schemas.js";
import {
  parseGhGraphqlRepository,
  parseGitHubOrigin,
  runGh,
} from "./delivery.js";
import { IssueError } from "./errors.js";
import { getOriginRemoteUrl } from "./git-read.js";

type Project = Extract<Issue, { kind: "project" }>;

export type ProjectGitHubRepo =
  | { workspace: string; owner: string; repo: string }
  | { error: string };

export type RepositoryQueryResult =
  | { repository: Record<string, unknown> }
  | { error: string };

/**
 * A stored ref may name the remote-tracking branch (`origin/main`).
 * GitHub's `headRefName` and `baseRefName` are the bare branch name.
 */
export function githubBranchName(ref: string): string {
  return ref.replace(/^(refs\/remotes\/)?origin\//, "");
}

/** Nodes of a GraphQL `pullRequests` connection. A missing connection is a read failure. */
export function pullRequestNodes(connection: unknown): unknown[] {
  if (
    typeof connection !== "object" ||
    connection === null ||
    !("nodes" in connection) ||
    !Array.isArray((connection as { nodes: unknown }).nodes)
  ) {
    throw new IssueError(
      "gh-failed",
      "gh graphql returned an unexpected pull request",
    );
  }
  return (connection as { nodes: unknown[] }).nodes;
}

/** Workspace, owner, and repo for a Project, or the same error reconcile reports. */
export async function resolveProjectGitHubRepo(
  project: Project,
): Promise<ProjectGitHubRepo> {
  if (!project.workspace) return { error: "Project workspace is not set" };
  const origin = await getOriginRemoteUrl(project.workspace);
  if (!origin) return { error: "Project workspace has no origin remote" };
  const parsed = parseGitHubOrigin(origin);
  if (!parsed) return { error: `origin is not a GitHub repository: ${origin}` };
  return { workspace: project.workspace, owner: parsed.owner, repo: parsed.repo };
}

/** One aliased `pullRequests` field. `nodes` is the GraphQL selection, braces included. */
export function pullRequestsField(options: {
  alias: string;
  first: number;
  states: string;
  head: string;
  base: string;
  nodes: string;
}): string {
  const { alias, first, states, head, base, nodes } = options;
  return `${alias}: pullRequests(first: ${first}, states: [${states}], headRefName: ${JSON.stringify(head)}, baseRefName: ${JSON.stringify(base)}) {
      nodes ${nodes}
    }`;
}

/**
 * Read aliased `pullRequests` connections. A malformed connection returns
 * `error` so the caller writes nothing.
 */
export function pullRequestAliases(
  repository: Record<string, unknown>,
  aliases: readonly string[],
): { connections: Map<string, unknown[]> } | { error: string } {
  try {
    const connections = new Map<string, unknown[]>();
    for (const alias of aliases) {
      connections.set(alias, pullRequestNodes(repository[alias]));
    }
    return { connections };
  } catch (err) {
    if (err instanceof IssueError) return { error: err.message };
    throw err;
  }
}

/** Run one repository GraphQL query. `gh` failures return `error`. */
export async function queryRepository(
  workspace: string,
  owner: string,
  repo: string,
  fields: string,
): Promise<RepositoryQueryResult> {
  const query = `query {
  repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(repo)}) {
    ${fields}
  }
}`;
  try {
    const stdout = await runGh(
      ["api", "graphql", "-f", `query=${query}`],
      workspace,
    );
    const repository = parseGhGraphqlRepository(stdout);
    if (!repository) return { error: "gh graphql returned no repository" };
    return { repository };
  } catch (err) {
    if (err instanceof IssueError) return { error: err.message };
    throw err;
  }
}
