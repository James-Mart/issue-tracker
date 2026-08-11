import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { z } from "zod";
import { IssueError } from "./errors.js";
import { readAll, readIssueOrThrow } from "./issues.js";
import { requireProjectWorkspace } from "./project-workspace.js";
import { subtreeIds } from "./subtree.js";

const GITHUB_PR_URL =
  /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/;

/** @internal Test seam for stubbing gh spawn. */
export type GhSpawner = (
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
) => ChildProcessWithoutNullStreams;

const defaultGhSpawner: GhSpawner = (command, args, options) =>
  spawn(command, args, {
    ...options,
    stdio: ["ignore", "pipe", "pipe"],
  });

let ghSpawner: GhSpawner = defaultGhSpawner;

/** @internal Restore default spawn after tests. */
export function setGhSpawnerForTests(next: GhSpawner | null): void {
  ghSpawner = next ?? defaultGhSpawner;
}

function isGhAuthFailure(stderr: string): boolean {
  const lower = stderr.toLowerCase();
  return (
    lower.includes("not logged into") ||
    lower.includes("gh_token") ||
    lower.includes("authentication") ||
    lower.includes("401") ||
    lower.includes("invalid token") ||
    lower.includes("no oauth token")
  );
}

function isGraphqlPartialData(args: string[], stdout: string): boolean {
  if (args[0] !== "api" || !args.includes("graphql")) return false;
  const trimmed = stdout.trim();
  if (!trimmed) return false;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      "data" in parsed &&
      (parsed as { data: unknown }).data !== undefined
    );
  } catch {
    return false;
  }
}

export async function runGh(
  args: string[],
  workspace: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const child = ghSpawner("gh", args, {
      cwd: workspace,
      env: process.env,
    });

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk;
    });

    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        reject(new IssueError("gh-missing", "gh binary not found"));
        return;
      }
      reject(new IssueError("gh-failed", err.message));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      const errText = stderr.trim() || `gh exited with code ${code}`;
      if (isGhAuthFailure(stderr)) {
        reject(new IssueError("gh-unauthenticated", errText));
        return;
      }
      // GraphQL returns exit 1 when errors[] is present, even if `data` has
      // usable partial results (e.g. a null pullRequest → not-found).
      if (isGraphqlPartialData(args, stdout)) {
        resolve(stdout);
        return;
      }
      reject(new IssueError("gh-failed", errText));
    });
  });
}

export function parsePrUrl(prUrl: string): {
  owner: string;
  repo: string;
  number: number;
} {
  const match = GITHUB_PR_URL.exec(prUrl);
  if (!match) {
    throw new IssueError(
      "not-github-pr-url",
      `not a GitHub pull request URL: ${prUrl}`,
    );
  }
  return {
    owner: match[1]!,
    repo: match[2]!,
    number: Number(match[3]!),
  };
}

const prCommentSchema = z.object({
  author: z.string().nullable(),
  body: z.string(),
  createdAt: z.string(),
  url: z.string(),
});

const prChecksSchema = z.object({
  state: z.enum(["success", "failure", "pending", "none"]),
  failing: z.number().int(),
  pending: z.number().int(),
  total: z.number().int(),
});

export const prFactsSchema = z.object({
  number: z.number().int(),
  url: z.string(),
  state: z.enum(["open", "closed", "merged"]),
  isDraft: z.boolean(),
  mergeable: z.enum(["mergeable", "conflicting", "unknown"]),
  mergeStateStatus: z.string(),
  reviewDecision: z
    .enum(["approved", "changes-requested", "review-required"])
    .nullable(),
  checks: prChecksSchema,
  commentCount: z.number().int(),
  comments: z.array(prCommentSchema),
  headRefOid: z.string(),
  baseRefName: z.string(),
  updatedAt: z.string(),
});

export type PrFacts = z.infer<typeof prFactsSchema>;

export type PrUnavailable = { reason: "not-found" };

const ghStateCountSchema = z.object({
  state: z.string(),
  count: z.number().int(),
});

const ghPullRequestSchema = z.object({
  number: z.number().int(),
  url: z.string(),
  state: z.enum(["OPEN", "CLOSED", "MERGED"]),
  isDraft: z.boolean(),
  mergeable: z.enum(["MERGEABLE", "CONFLICTING", "UNKNOWN"]),
  mergeStateStatus: z.string(),
  reviewDecision: z
    .enum(["APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED"])
    .nullable(),
  headRefOid: z.string(),
  baseRefName: z.string(),
  updatedAt: z.string(),
  comments: z.object({
    totalCount: z.number().int(),
    nodes: z.array(
      z.object({
        author: z.object({ login: z.string() }).nullable(),
        body: z.string(),
        createdAt: z.string(),
        url: z.string(),
      }),
    ),
  }),
  commits: z.object({
    nodes: z.array(
      z.object({
        commit: z.object({
          statusCheckRollup: z
            .object({
              state: z.enum([
                "EXPECTED",
                "ERROR",
                "FAILURE",
                "PENDING",
                "SUCCESS",
              ]),
              contexts: z.object({
                totalCount: z.number().int(),
                checkRunCountsByState: z.array(ghStateCountSchema),
                statusContextCountsByState: z.array(ghStateCountSchema),
              }),
            })
            .nullable(),
        }),
      }),
    ),
  }),
});

type GhPullRequest = z.infer<typeof ghPullRequestSchema>;

const FAILING_CHECK_RUN_STATES = new Set([
  "FAILURE",
  "TIMED_OUT",
  "STARTUP_FAILURE",
  "CANCELLED",
  "ACTION_REQUIRED",
]);
const PENDING_CHECK_RUN_STATES = new Set([
  "PENDING",
  "QUEUED",
  "IN_PROGRESS",
  "WAITING",
]);
const FAILING_STATUS_STATES = new Set(["ERROR", "FAILURE"]);
const PENDING_STATUS_STATES = new Set(["PENDING", "EXPECTED"]);

function sumCounts(
  rows: Array<{ state: string; count: number }>,
  wanted: Set<string>,
): number {
  let total = 0;
  for (const row of rows) {
    if (wanted.has(row.state)) total += row.count;
  }
  return total;
}

function mapChecks(pr: GhPullRequest): PrFacts["checks"] {
  const rollup = pr.commits.nodes[0]?.commit.statusCheckRollup ?? null;
  if (!rollup) {
    return { state: "none", failing: 0, pending: 0, total: 0 };
  }
  const failing =
    sumCounts(rollup.contexts.checkRunCountsByState, FAILING_CHECK_RUN_STATES) +
    sumCounts(
      rollup.contexts.statusContextCountsByState,
      FAILING_STATUS_STATES,
    );
  const pending =
    sumCounts(rollup.contexts.checkRunCountsByState, PENDING_CHECK_RUN_STATES) +
    sumCounts(
      rollup.contexts.statusContextCountsByState,
      PENDING_STATUS_STATES,
    );
  const state: PrFacts["checks"]["state"] =
    rollup.state === "SUCCESS"
      ? "success"
      : rollup.state === "FAILURE" || rollup.state === "ERROR"
        ? "failure"
        : "pending";
  return {
    state,
    failing,
    pending,
    total: rollup.contexts.totalCount,
  };
}

function mapReviewDecision(
  value: GhPullRequest["reviewDecision"],
): PrFacts["reviewDecision"] {
  if (value === "APPROVED") return "approved";
  if (value === "CHANGES_REQUESTED") return "changes-requested";
  if (value === "REVIEW_REQUIRED") return "review-required";
  return null;
}

function mapPullRequest(raw: unknown): PrFacts {
  const pr = ghPullRequestSchema.parse(raw);
  const state: PrFacts["state"] =
    pr.state === "OPEN" ? "open" : pr.state === "MERGED" ? "merged" : "closed";
  const mergeable: PrFacts["mergeable"] =
    pr.mergeable === "MERGEABLE"
      ? "mergeable"
      : pr.mergeable === "CONFLICTING"
        ? "conflicting"
        : "unknown";
  return prFactsSchema.parse({
    number: pr.number,
    url: pr.url,
    state,
    isDraft: pr.isDraft,
    mergeable,
    mergeStateStatus: pr.mergeStateStatus,
    reviewDecision: mapReviewDecision(pr.reviewDecision),
    checks: mapChecks(pr),
    commentCount: pr.comments.totalCount,
    comments: pr.comments.nodes.map((node) => ({
      author: node.author?.login ?? null,
      body: node.body,
      createdAt: node.createdAt,
      url: node.url,
    })),
    headRefOid: pr.headRefOid,
    baseRefName: pr.baseRefName,
    updatedAt: pr.updatedAt,
  });
}

const PR_SELECTION = `{
  number
  url
  state
  isDraft
  mergeable
  mergeStateStatus
  reviewDecision
  headRefOid
  baseRefName
  updatedAt
  comments(last: 10) {
    totalCount
    nodes {
      author { login }
      body
      createdAt
      url
    }
  }
  commits(last: 1) {
    nodes {
      commit {
        statusCheckRollup {
          state
          contexts {
            totalCount
            checkRunCountsByState { state count }
            statusContextCountsByState { state count }
          }
        }
      }
    }
  }
}`;

function aliasFor(number: number): string {
  return `pr_${number}`;
}

function buildRepoQuery(
  owner: string,
  repo: string,
  numbers: number[],
): string {
  const fields = numbers
    .map((n) => `${aliasFor(n)}: pullRequest(number: ${n}) ${PR_SELECTION}`)
    .join("\n");
  return `query {
  repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(repo)}) {
    ${fields}
  }
}`;
}

type ParsedUrl = {
  prUrl: string;
  owner: string;
  repo: string;
  number: number;
};

async function fetchRepoGroup(
  owner: string,
  repo: string,
  entries: ParsedUrl[],
  workspace: string,
): Promise<Map<string, PrFacts | PrUnavailable>> {
  const numbers = [...new Set(entries.map((e) => e.number))];
  const query = buildRepoQuery(owner, repo, numbers);
  const stdout = await runGh(
    ["api", "graphql", "-f", `query=${query}`],
    workspace,
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new IssueError("gh-failed", "gh graphql returned non-JSON stdout");
  }
  const repository = (
    parsed as {
      data?: { repository?: Record<string, unknown> | null };
    }
  ).data?.repository;

  const out = new Map<string, PrFacts | PrUnavailable>();
  for (const entry of entries) {
    if (!repository) {
      out.set(entry.prUrl, { reason: "not-found" });
      continue;
    }
    const raw = repository[aliasFor(entry.number)];
    if (raw == null) {
      out.set(entry.prUrl, { reason: "not-found" });
      continue;
    }
    out.set(entry.prUrl, mapPullRequest(raw));
  }
  return out;
}

/**
 * Live PR facts for many URLs, batched into one GraphQL call per
 * `<owner>/<repo>`. Never writes facts to an issue.
 */
export async function readPullRequests(
  prUrls: string[],
  workspace: string,
): Promise<Map<string, PrFacts | PrUnavailable>> {
  if (prUrls.length === 0) return new Map();

  const parsed: ParsedUrl[] = prUrls.map((prUrl) => {
    const { owner, repo, number } = parsePrUrl(prUrl);
    return { prUrl, owner, repo, number };
  });

  const groups = new Map<string, ParsedUrl[]>();
  for (const entry of parsed) {
    const key = `${entry.owner}/${entry.repo}`;
    const list = groups.get(key);
    if (list) list.push(entry);
    else groups.set(key, [entry]);
  }

  const out = new Map<string, PrFacts | PrUnavailable>();
  for (const [, entries] of groups) {
    const first = entries[0]!;
    const groupResult = await fetchRepoGroup(
      first.owner,
      first.repo,
      entries,
      workspace,
    );
    for (const [url, value] of groupResult) {
      out.set(url, value);
    }
  }
  return out;
}

export type ProjectPrsResponse = {
  prs: Record<string, PrFacts | PrUnavailable>;
};

/**
 * Live PR facts keyed by Story id for every Story in the Project that
 * carries a `prUrl`. Skips `gh` entirely when none do.
 */
export async function readProjectPrs(
  projectId: string,
): Promise<ProjectPrsResponse> {
  const project = readIssueOrThrow(projectId);
  if (project.kind !== "project") {
    throw new IssueError("not_found", `unknown issue "${projectId}"`);
  }

  const { issues } = readAll();
  const inProject = subtreeIds(issues, projectId);
  const storiesWithPr = issues.filter(
    (issue): issue is typeof issue & { kind: "story"; prUrl: string } =>
      issue.kind === "story" &&
      inProject.has(issue.id) &&
      issue.prUrl !== undefined,
  );

  if (storiesWithPr.length === 0) {
    return { prs: {} };
  }

  const workspace = requireProjectWorkspace(projectId);
  const byUrl = await readPullRequests(
    storiesWithPr.map((story) => story.prUrl),
    workspace,
  );

  const prs: Record<string, PrFacts | PrUnavailable> = {};
  for (const story of storiesWithPr) {
    prs[story.id] = byUrl.get(story.prUrl)!;
  }
  return { prs };
}
