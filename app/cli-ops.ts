import { readFileSync } from "fs";
import { basename } from "path";
import type { Command } from "commander";
import { assigneeOf } from "./server/assignee.js";
import { hasAttention, hasPartOf, kindHas } from "./server/kind.js";
import type { IssueDetail, IssueKind } from "./server/schemas.js";
import { CHIP_UNSET } from "./server/services/merge-base.js";
import {
  appendMessage,
  list,
  read,
  readChat,
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
import { formatSupportingDocsLine } from "./server/services/supporting-docs.js";
import { assertKind } from "./cli-kind.js";

type Run = (action: () => unknown) => Promise<void>;

type ViewOptions = {
  chat?: boolean;
};

function labelIdsForView(detail: IssueDetail): string[] {
  if (detail.kind === "project") {
    return (detail.labels ?? []).map((label) => label.id);
  }
  if (detail.kind === "epic" || detail.kind === "idea" || detail.kind === "story") {
    return detail.labels ?? [];
  }
  return [];
}

function printIssueView(id: string, opts: ViewOptions = {}): void {
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
  }
  if (hasPartOf(detail)) lines.push(`partOf: ${detail.partOf}`);
  if (detail.kind === "epic" && detail.blockedBy.length > 0) {
    lines.push(`blockedBy: ${detail.blockedBy.join(", ")}`);
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
    if (detail.specReview) lines.push(`specReview: ${detail.specReview}`);
  }
  if (detail.kind === "task") {
    lines.push(`status: ${detail.status}`);
    if (detail.qa) lines.push(`qa: ${detail.qa}`);
    if (detail.commitSha) lines.push(`commitSha: ${detail.commitSha}`);
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

  if (opts.chat) {
    const { messages, problems } = readChat(id);
    console.log();
    console.log("--- chat ---");
    if (messages.length === 0) console.log("(no messages)");
    for (const message of messages) {
      console.log(`[${message.at}] ${message.name ?? message.role}: ${message.body}`);
    }
    // Malformed chat lines are surfaced as stderr warnings but deliberately
    // do not fail the command: like list()'s `problems`, they are data
    // warnings, not a failure of `view` itself, which still printed the
    // issue and every parseable message. Only thrown errors (e.g. unknown
    // id) set a nonzero exit code.
    for (const problem of problems) {
      console.error(`chat problem: ${problem.message}`);
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

async function printComment(
  id: string,
  opts: { role: string; body: string; name?: string },
): Promise<void> {
  const message = await appendMessage(id, {
    role: opts.role,
    name: opts.name,
    body: opts.body,
  });
  console.log(`commented on ${id} as ${message.name ?? message.role}`);
}

function registerViewCommand(parent: Command, run: Run, kind: IssueKind): void {
  parent
    .command("view")
    .argument("<id>", "issue id")
    .description(
      "print an issue's metadata and description (pass --chat for the chat log)",
    )
    .option("--chat", "also print the chat log")
    .action((id: string, opts: ViewOptions) =>
      run(() => {
        assertKind(kind, id);
        printIssueView(id, opts);
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
  parent
    .command("comment")
    .argument("<id>", "issue id")
    .requiredOption("--role <role>", "message author role (e.g. agent, human)")
    .requiredOption("--body <text>", "message body (Markdown)")
    .option("--name <name>", "author display name")
    .action(
      (
        id: string,
        opts: { role: string; body: string; name?: string },
      ) =>
        run(async () => {
          assertKind(kind, id);
          await printComment(id, opts);
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
}
