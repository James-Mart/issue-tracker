import { readFileSync } from "fs";
import { basename } from "path";
import type { Command } from "commander";
import { assigneeOf } from "./server/assignee.js";
import {
  articleForKind,
  hasAttention,
  hasPartOf,
  kindHas,
  KIND_LABEL,
} from "./server/kind.js";
import type {
  Comment,
  CommentInput,
  CommentMessage,
  IssueDetail,
  IssueKind,
} from "./server/schemas.js";
import { readCommentsWithOutdated } from "./server/services/anchor-outdated.js";
import { CHIP_UNSET } from "./server/services/merge-base.js";
import {
  appendComment,
  list,
  read,
  remove,
} from "./server/services/issues.js";
import {
  attachmentPath,
  listAttachments,
  putAttachment,
  removeAttachment,
} from "./server/services/attachments.js";
import { formatAttachmentsSection } from "./server/services/summary.js";
import { formatInspirationAppsLine } from "./server/services/inspiration-apps.js";
import { formatPersonasLine } from "./server/services/personas.js";
import { formatSupportingDocsLine } from "./server/services/supporting-docs.js";
import { coerceEnum, coercePositiveInt } from "./cli-coerce.js";
import { assertKind, kindGetValue, resolveIssueKind } from "./cli-kind.js";
import { parsePrUrl, runGh } from "./server/services/delivery.js";
import { applyMergeConsequences } from "./server/services/merge-consequences.js";
import { readAll } from "./server/services/issues.js";
import { requireProjectWorkspace } from "./server/services/project-workspace.js";
import { ancestorChain } from "./server/services/subtree.js";
import { taskHeadCommit } from "./server/services/commit-sha.js";

type Run = (action: () => unknown) => Promise<void>;

export type MergeStoryOptions = {
  auto?: boolean;
  matchHeadCommit?: string;
};

function mergeKindRefusal(kind: IssueKind, id: string): string {
  return `"${id}" is ${articleForKind(kind)} ${KIND_LABEL[kind]}; merge is only valid on a Story (issue merge <storyId>)`;
}

/** Merge a Story's GitHub PR via `gh pr merge --merge`. */
export async function mergeStory(
  id: string,
  opts: MergeStoryOptions = {},
): Promise<void> {
  const detail = read(id);
  if (detail.kind !== "story") {
    throw new Error(mergeKindRefusal(detail.kind, id));
  }
  if (!detail.prUrl) {
    throw new Error(`story "${id}" has no prUrl`);
  }

  const { owner, repo, number } = parsePrUrl(detail.prUrl);
  const { issues } = readAll();
  const projectId = ancestorChain(id, issues)[0]!.id;
  const workspace = requireProjectWorkspace(projectId);

  const args = [
    "pr",
    "merge",
    String(number),
    "--merge",
    "-R",
    `${owner}/${repo}`,
  ];
  if (opts.auto) args.push("--auto");
  if (opts.matchHeadCommit) {
    args.push("--match-head-commit", opts.matchHeadCommit);
  }

  await runGh(args, workspace);
  await applyMergeConsequences(id);
}

type ViewOptions = {
  comments?: boolean;
};

function commentAuthor(message: Comment): string {
  return message.name ?? message.role;
}

function formatAnchorLocation(anchor: NonNullable<Comment["anchor"]>): string {
  const linePart =
    anchor.startLine !== undefined
      ? `${anchor.startLine}-${anchor.line}`
      : String(anchor.line);
  return `${anchor.path}:${linePart} ${anchor.side} ${anchor.commitSha.slice(0, 7)}`;
}

function formatCommentLine(message: CommentMessage, indent = ""): string {
  const author = commentAuthor(message);
  const head = `${indent}${message.id} [${message.at}] ${author}`;
  if (message.anchor) {
    const outdated = message.outdated ? " (outdated)" : "";
    return `${head} @ ${formatAnchorLocation(message.anchor)}${outdated}: ${message.body}`;
  }
  return `${head}: ${message.body}`;
}

function formatCommentsForView(messages: CommentMessage[]): string[] {
  const rootIds = new Set(
    messages.filter((message) => !message.replyTo).map((message) => message.id),
  );
  const repliesByRoot = new Map<string, Comment[]>();
  for (const message of messages) {
    if (message.replyTo && rootIds.has(message.replyTo)) {
      const list = repliesByRoot.get(message.replyTo) ?? [];
      list.push(message);
      repliesByRoot.set(message.replyTo, list);
    }
  }

  const lines: string[] = [];
  for (const message of messages) {
    if (message.replyTo && rootIds.has(message.replyTo)) continue;
    lines.push(formatCommentLine(message));
    for (const reply of repliesByRoot.get(message.id) ?? []) {
      lines.push(formatCommentLine(reply, "  "));
    }
  }
  return lines;
}

function labelIdsForView(detail: IssueDetail): string[] {
  if (detail.kind === "project") {
    return (detail.labels ?? []).map((label) => label.id);
  }
  if (detail.kind === "epic" || detail.kind === "idea" || detail.kind === "story") {
    return detail.labels ?? [];
  }
  return [];
}

async function printIssueView(id: string, opts: ViewOptions = {}): Promise<void> {
  const detail = read(id);
  const lines = [
    `id: ${detail.id}`,
    `kind: ${detail.kind}`,
    `title: ${detail.title}`,
  ];
  if (detail.kind === "project") {
    lines.push(`mergePolicy: ${detail.mergePolicy}`);
    if (detail.workspace) {
      lines.push(`workspace: ${detail.workspace}`);
    }
    if (detail.supportingDocs) {
      const line = formatSupportingDocsLine(detail.supportingDocs);
      if (line) lines.push(`supportingDocs: ${line}`);
    }
    if (detail.inspirationApps && detail.inspirationApps.length > 0) {
      const line = formatInspirationAppsLine(detail.inspirationApps);
      if (line) lines.push(`inspirationApps: ${line}`);
    }
    if (detail.personas && detail.personas.length > 0) {
      const line = formatPersonasLine(detail.personas);
      if (line) lines.push(`personas: ${line}`);
    }
  }
  if (hasPartOf(detail)) lines.push(`partOf: ${detail.partOf}`);
  if (detail.kind === "epic" && detail.blockedBy.length > 0) {
    lines.push(`blockedBy: ${detail.blockedBy.join(", ")}`);
  }
  if (
    (detail.kind === "epic" || detail.kind === "story") &&
    detail.sourceIdea
  ) {
    lines.push(`sourceIdea: ${detail.sourceIdea}`);
  }
  const labelIds = labelIdsForView(detail);
  if (labelIds.length > 0) {
    lines.push(`labels: ${labelIds.join(", ")}`);
  }
  if (detail.kind === "story") {
    if (detail.stackedOn) lines.push(`stackedOn: ${detail.stackedOn}`);
    const mergeBase = list().derived[id]?.mergeBase;
    lines.push(`mergeBase: ${mergeBase ?? CHIP_UNSET}`);
    if (detail.branchName) lines.push(`branchName: ${detail.branchName}`);
    if (detail.prUrl) lines.push(`prUrl: ${detail.prUrl}`);
    lines.push(`merged: ${detail.merged}`);
    if (detail.review) lines.push(`review: ${detail.review}`);
    if (detail.needsRebase) lines.push(`needsRebase: ${detail.needsRebase}`);
  }
  if (detail.kind === "idea" && detail.stakeholder) {
    lines.push(`stakeholder: ${detail.stakeholder}`);
  }
  if (detail.kind === "task") {
    lines.push(`status: ${detail.status}`);
    if (detail.qa) lines.push(`qa: ${detail.qa}`);
    const head = taskHeadCommit(detail);
    if (head) lines.push(`commitSha: ${head}`);
    if (detail.noDiff) lines.push(`noDiff: true`);
  }
  if (hasPartOf(detail)) {
    const assignee = assigneeOf(detail);
    if (assignee) lines.push(`assignee: ${assignee}`);
    if (hasAttention(detail) && detail.needsAttention) {
      lines.push(`attention: ${detail.attentionReason ?? "(no reason)"}`);
    }
  }
  if (kindHas(detail.kind, "attachments")) {
    lines.push(...formatAttachmentsSection(id, listAttachments(id)));
  }
  console.log(lines.join("\n"));
  console.log();
  console.log(detail.description || "(no description)");

  if (opts.comments) {
    const { messages, problems } = await readCommentsWithOutdated(id);
    console.log();
    console.log("--- comments ---");
    if (messages.length === 0) console.log("(no messages)");
    for (const line of formatCommentsForView(messages)) {
      console.log(line);
    }
    // Malformed comment lines are surfaced as stderr warnings but deliberately
    // do not fail the command: like list()'s `problems`, they are data
    // warnings, not a failure of `view` itself, which still printed the
    // issue and every parseable message. Only thrown errors (e.g. unknown
    // id) set a nonzero exit code.
    for (const problem of problems) {
      console.error(`comment problem: ${problem.message}`);
    }
  }
}

async function printDeleteResult(id: string): Promise<void> {
  const result = await remove(id);
  console.log(`deleted ${result.deleted.join(", ")}`);
  for (const { id: bid, to } of result.repointed) {
    console.log(`  repointed ${bid}.stackedOn -> ${to ?? "main"}`);
  }
  for (const { id: bid } of result.unblocked) {
    console.log(`  dropped deleted blocker from ${bid}.blockedBy`);
  }
  for (const { id: bid } of result.droppedSourceIdea) {
    console.log(`  cleared ${bid}.sourceIdea`);
  }
}

async function printAttach(id: string, file: string): Promise<void> {
  const bytes = readFileSync(file);
  const meta = await putAttachment(id, basename(file), bytes);
  console.log(
    `attached ${meta.name} (${meta.size} bytes) — ${attachmentPath(id, meta.name)}`,
  );
}

function printAttachments(id: string): void {
  const attachments = listAttachments(id);
  if (attachments.length === 0) {
    console.log("(no attachments)");
    return;
  }
  for (const att of attachments) {
    console.log(`${att.name}\t${att.size}`);
  }
}

async function printDetach(id: string, name: string): Promise<void> {
  await removeAttachment(id, name);
  console.log(`detached ${name} from ${id}`);
}

function registerMergeCommand(parent: Command, run: Run, kind: IssueKind): void {
  parent
    .command("merge")
    .argument("<id>", "story id")
    .description("merge a Story's GitHub pull request (merge commit)")
    .option(
      "--auto",
      "enable auto-merge when checks are the only remaining requirement",
    )
    .option(
      "--match-head-commit <sha>",
      "merge only when the PR head matches this commit",
    )
    .action(
      (
        id: string,
        opts: { auto?: boolean; matchHeadCommit?: string },
      ) =>
        run(async () => {
          assertKind(kind, id);
          await mergeStory(id, opts);
        }),
    );
}

type CommentCliOptions = {
  role: string;
  body: string;
  name?: string;
  path?: string;
  side?: string;
  line?: string;
  startLine?: string;
  commit?: string;
  replyTo?: string;
};

function commentInputFromCliOpts(opts: CommentCliOptions): CommentInput {
  const anyAnchor =
    opts.path !== undefined ||
    opts.side !== undefined ||
    opts.line !== undefined ||
    opts.startLine !== undefined ||
    opts.commit !== undefined;

  if (opts.replyTo && anyAnchor) {
    throw new Error(
      "--reply-to cannot be combined with anchor flags (--path, --side, --line, --start-line, --commit)",
    );
  }

  if (anyAnchor) {
    if (!opts.path || !opts.side || !opts.line || !opts.commit) {
      throw new Error(
        "anchor requires --path, --side, --line, and --commit",
      );
    }
    return {
      role: opts.role,
      name: opts.name,
      body: opts.body,
      anchor: {
        path: opts.path,
        side: coerceEnum(opts.side, "side", ["old", "new"]) as "old" | "new",
        line: coercePositiveInt(opts.line, "line"),
        commitSha: opts.commit,
        ...(opts.startLine !== undefined
          ? { startLine: coercePositiveInt(opts.startLine, "start-line") }
          : {}),
      },
    };
  }

  if (opts.replyTo) {
    return {
      role: opts.role,
      name: opts.name,
      body: opts.body,
      replyTo: opts.replyTo,
    };
  }

  return {
    role: opts.role,
    name: opts.name,
    body: opts.body,
  };
}

function applyCommentOptions(cmd: Command): Command {
  return cmd
    .option("--path <path>", "repository-relative file path for a line anchor")
    .option(
      "--side <old|new>",
      "which side of the diff the anchor points at",
    )
    .option("--line <n>", "anchored line (1-based) on that side")
    .option("--start-line <n>", "optional range start (1-based)")
    .option(
      "--commit <sha>",
      "full commit sha the anchor binds to (never inferred from the issue)",
    )
    .option(
      "--reply-to <commentId>",
      "post as a reply to that thread root (mutually exclusive with anchor flags)",
    );
}

async function printComment(
  id: string,
  opts: CommentCliOptions,
): Promise<Comment> {
  return appendComment(id, commentInputFromCliOpts(opts));
}

function registerViewCommand(parent: Command, run: Run, kind: IssueKind): void {
  parent
    .command("view")
    .argument("<id>", "issue id")
    .description(
      "print an issue's metadata and description (pass --comments for the comment log)",
    )
    .option("--comments", "also print the comment log")
    .action((id: string, opts: ViewOptions) =>
      run(async () => {
        assertKind(kind, id);
        await printIssueView(id, opts);
      }),
    );
}

function registerDeleteCommand(parent: Command, run: Run, kind: IssueKind): void {
  parent
    .command("delete")
    .argument("<id>", "issue id")
    .description(
      "delete an issue: cascades to contained children, splices stackedOn, drops blockedBy",
    )
    .action((id: string) =>
      run(async () => {
        assertKind(kind, id);
        await printDeleteResult(id);
      }),
    );
}

function registerCommentCommand(parent: Command, run: Run, kind: IssueKind): void {
  applyCommentOptions(
    parent
      .command("comment")
      .argument("<id>", "issue id")
      .requiredOption("--role <role>", "message author role (e.g. agent, human)")
      .requiredOption("--body <text>", "message body (Markdown)")
      .option("--name <name>", "author display name"),
  ).action(
    (id: string, opts: CommentCliOptions) =>
      run(async () => {
        assertKind(kind, id);
        return printComment(id, opts);
      }),
  );
}

function registerAttachCommands(parent: Command, run: Run, kind: IssueKind): void {
  parent
    .command("attach")
    .argument("<id>", "issue id")
    .argument("<file>", "path to file to attach")
    .description(
      "attach a file; on basename collision keeps the existing file and stores under a unique name; prints the stored basename",
    )
    .action((id: string, file: string) =>
      run(async () => {
        assertKind(kind, id);
        await printAttach(id, file);
      }),
    );

  parent
    .command("attachments")
    .argument("<id>", "issue id")
    .description("list attachment names and sizes")
    .action((id: string) =>
      run(() => {
        assertKind(kind, id);
        printAttachments(id);
      }),
    );

  parent
    .command("detach")
    .argument("<id>", "issue id")
    .argument("<name>", "attachment basename to remove")
    .action((id: string, name: string) =>
      run(async () => {
        assertKind(kind, id);
        await printDetach(id, name);
      }),
    );
}

export function registerKindOps(
  kindCmd: Command,
  kind: IssueKind,
  run: Run,
): void {
  registerViewCommand(kindCmd, run, kind);
  registerDeleteCommand(kindCmd, run, kind);
  if (kindHas(kind, "comment")) {
    registerCommentCommand(kindCmd, run, kind);
  }
  if (kindHas(kind, "attachments")) {
    registerAttachCommands(kindCmd, run, kind);
  }
  if (kind === "story") {
    registerMergeCommand(kindCmd, run, kind);
  }
}

export function registerBareIdOps(program: Command, run: Run): void {
  program
    .command("view")
    .argument("<id>", "issue id")
    .description(
      "print an issue's metadata and description (pass --comments for the comment log)",
    )
    .option("--comments", "also print the comment log")
    .action((id: string, opts: ViewOptions) =>
      run(async () => {
        resolveIssueKind(id);
        await printIssueView(id, opts);
      }),
    );

  program
    .command("get")
    .argument("<id>", "issue id")
    .argument("<field>", "field name (camelCase)")
    .action((id: string, field: string) =>
      run(() => {
        const kind = resolveIssueKind(id);
        const value = kindGetValue(kind, id, field);
        if (value === null) return;
        process.stdout.write(value.endsWith("\n") ? value : `${value}\n`);
      }),
    );

  applyCommentOptions(
    program
      .command("comment")
      .argument("<id>", "issue id")
      .requiredOption("--role <role>", "message author role (e.g. agent, human)")
      .requiredOption("--body <text>", "message body (Markdown)")
      .option("--name <name>", "author display name"),
  ).action(
    (id: string, opts: CommentCliOptions) =>
      run(async () => {
        const kind = resolveIssueKind(id);
        if (!kindHas(kind, "comment")) {
          throw new Error(
            `"${id}" is ${articleForKind(kind)} ${KIND_LABEL[kind]}; projects have no comment log`,
          );
        }
        return printComment(id, opts);
      }),
  );

  program
    .command("attach")
    .argument("<id>", "issue id")
    .argument("<file>", "path to file to attach")
    .description(
      "attach a file; on basename collision keeps the existing file and stores under a unique name; prints the stored basename",
    )
    .action((id: string, file: string) =>
      run(async () => {
        resolveIssueKind(id);
        await printAttach(id, file);
      }),
    );

  program
    .command("attachments")
    .argument("<id>", "issue id")
    .description("list attachment names and sizes")
    .action((id: string) =>
      run(() => {
        resolveIssueKind(id);
        printAttachments(id);
      }),
    );

  program
    .command("detach")
    .argument("<id>", "issue id")
    .argument("<name>", "attachment basename to remove")
    .action((id: string, name: string) =>
      run(async () => {
        resolveIssueKind(id);
        await printDetach(id, name);
      }),
    );

  program
    .command("merge")
    .argument("<id>", "story id")
    .description("merge a Story's GitHub pull request (merge commit)")
    .option(
      "--auto",
      "enable auto-merge when checks are the only remaining requirement",
    )
    .option(
      "--match-head-commit <sha>",
      "merge only when the PR head matches this commit",
    )
    .action(
      (
        id: string,
        opts: { auto?: boolean; matchHeadCommit?: string },
      ) =>
        run(async () => {
          const kind = resolveIssueKind(id);
          if (kind !== "story") {
            throw new Error(mergeKindRefusal(kind, id));
          }
          await mergeStory(id, opts);
        }),
    );
}
