import { execFile } from "node:child_process";
import { isAbsolute } from "node:path";
import { promisify } from "node:util";
import type { SDKCustomTool, SDKJsonValue } from "@cursor/sdk";
import { z } from "zod";
import { kindHas } from "../kind.js";
import { KIND_GET_FIELDS } from "../kind-fields.js";
import { bySequence } from "../order.js";
import { attachmentPath, listAttachments } from "./attachments.js";
import { readComments } from "./comment-append.js";
import { readAll } from "./issues.js";
import { readDescription } from "./issues-detail.js";
import { subtreeIds } from "./subtree.js";
import { formatSummary, summarize } from "./summary.js";

const execFileAsync = promisify(execFile);

const issueReadSchema = z.strictObject({
  operation: z.enum(["summary", "view", "get", "tree", "list", "attachments"]),
  id: z.string().min(1).optional().describe(
    "Issue id; required except for list. For list, limits results to this subtree.",
  ),
  field: z.string().min(1).optional().describe(
    "Required for get: a stored issue field or description.",
  ),
  kind: z.enum(["project", "epic", "story", "task", "idea", "review"])
    .optional().describe("Optional kind filter for list."),
});

function issueRead(input: z.infer<typeof issueReadSchema>): string {
  // CLI read/get/list can migrate the store or fetch refs. Snapshot reads and
  // stored fields keep this tool independent of those write-capable paths.
  const { issues } = readAll();
  const issue = issues.find((candidate) => candidate.id === input.id);
  if (input.id !== undefined && !issue) {
    throw new Error(`unknown issue "${input.id}"`);
  }
  if (input.operation === "list" || input.operation === "tree") {
    if (input.operation === "tree" && !issue) {
      throw new Error("tree requires id");
    }
    const ids = issue ? subtreeIds(issues, issue.id) : undefined;
    return JSON.stringify(issues.filter((candidate) =>
      (!ids || ids.has(candidate.id)) &&
      (input.kind === undefined || candidate.kind === input.kind)
    ).sort(bySequence));
  }
  if (!issue) throw new Error(`${input.operation} requires id`);
  switch (input.operation) {
    case "summary":
      return formatSummary(summarize(issue.id));
    case "get": {
      if (input.field === "description") return readDescription(issue.id);
      const fields = KIND_GET_FIELDS[issue.kind];
      if (!input.field || !Object.hasOwn(fields, input.field) ||
          Reflect.get(fields, input.field).source !== "stored") {
        throw new Error(`get requires a stored field of ${issue.kind}, or description`);
      }
      return JSON.stringify(Reflect.get(issue, input.field) ?? null);
    }
    case "view":
      return JSON.stringify({
        ...issue,
        description: readDescription(issue.id),
        comments: readComments(issue.id, issues),
      });
    case "attachments":
      if (!kindHas(issue.kind, "attachments")) {
        throw new Error(`${issue.kind} does not support attachments`);
      }
      return JSON.stringify(listAttachments(issue.id).map((attachment) => ({
        ...attachment,
        path: attachmentPath(issue.id, attachment.name),
      })));
  }
}

const gitRefSchema = z.string().min(1).regex(
  /^[^-\x00-\x20][^\x00-\x20]*$/,
  "Use a revision, not an option or a whitespace-separated command.",
);
const gitReadSchema = z.strictObject({
  operation: z.enum(["status", "diff", "show", "log", "tree", "files", "merge-base"]),
  workspace: z.string().min(1).describe("Absolute path to the Git worktree."),
  refs: z.array(gitRefSchema).max(2).optional().describe(
    "Revisions: diff accepts up to two; show, log, tree accept one (default HEAD); merge-base requires two.",
  ),
  path: z.string().min(1).optional().describe(
    "Optional path filter. With show, reads this file at the selected revision.",
  ),
  limit: z.number().int().min(1).max(200).optional().describe(
    "Maximum log entries (default 20).",
  ),
});

async function gitRead(input: z.infer<typeof gitReadSchema>): Promise<string> {
  if (!isAbsolute(input.workspace)) throw new Error("workspace must be absolute");
  const refs = input.refs ?? [];
  const path = input.path === undefined ? [] : [input.path];
  const paths = ["--", ...path];
  if (refs.length > 1 && !["diff", "merge-base"].includes(input.operation)) {
    throw new Error(`${input.operation} accepts at most one revision`);
  }
  let args: string[];
  switch (input.operation) {
    case "status":
      args = ["status", "--porcelain=v1", "--untracked-files=all", ...paths];
      break;
    case "diff":
      args = ["diff", "--no-ext-diff", "--no-textconv", ...refs, ...paths];
      break;
    case "show":
      args = ["show", "--no-ext-diff", "--no-textconv",
        input.path === undefined ? (refs[0] ?? "HEAD") : `${refs[0] ?? "HEAD"}:${input.path}`,
        "--"];
      break;
    case "log":
      args = ["log", "--no-ext-diff", "--no-textconv", `-n${input.limit ?? 20}`,
        refs[0] ?? "HEAD", ...paths];
      break;
    case "tree":
      args = ["ls-tree", "-r", refs[0] ?? "HEAD", ...paths];
      break;
    case "files":
      args = ["ls-files", ...paths];
      break;
    case "merge-base":
      if (refs.length !== 2) throw new Error("merge-base requires two revisions");
      args = ["merge-base", ...refs];
      break;
  }
  // Fixed argv and disabled helpers prevent Git config, attributes, or caller
  // flags from turning inspection into command execution or file output.
  const { stdout } = await execFileAsync("git", [
    "--no-pager", "--no-optional-locks",
    "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null",
    "-c", "log.showSignature=false", "-c", "diff.submodule=short",
    ...args,
  ], {
    cwd: input.workspace,
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
    encoding: "utf8",
    env: { ...process.env, GIT_NO_LAZY_FETCH: "1", GIT_TERMINAL_PROMPT: "0" },
  });
  return stdout;
}

export function createAgentReadTools(): Record<string, SDKCustomTool> {
  return {
    issue_read: {
      description: "Read tracker summaries, issue details and comments, stored fields, subtrees, lists, or attachment paths.",
      inputSchema: z.toJSONSchema(issueReadSchema) as Record<string, SDKJsonValue>,
      execute: async (args) => issueRead(issueReadSchema.parse(args)),
    },
    git_read: {
      description: "Inspect local Git status, diffs, history, files at revisions, trees, tracked paths, or merge bases.",
      inputSchema: z.toJSONSchema(gitReadSchema) as Record<string, SDKJsonValue>,
      execute: async (args) => gitRead(gitReadSchema.parse(args)),
    },
  };
}
