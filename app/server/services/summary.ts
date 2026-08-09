import type { Issue, IssueKind, InspirationApps, SupportingDocs } from "../schemas.js";
import { KIND_LABEL, kindHas } from "../kind.js";
import { attachmentPath, listAttachments } from "./attachments.js";
import { IssueError } from "./errors.js";
import { readAll } from "./issues.js";
import { ancestorChain } from "./subtree.js";
import { formatInspirationAppsLine } from "./inspiration-apps.js";
import {
  formatSupportingDocsLine,
  readMissionParagraph,
} from "./supporting-docs.js";

/** Name + size as rendered by show/summary; not full Attachment metadata. */
export interface SummaryAttachment {
  name: string;
  size: number;
}

export interface SummaryNode {
  kind: IssueKind;
  id: string;
  title: string;
  /** Set when a Task intentionally landed no source-controlled file changes. */
  noDiff?: true;
  /** Present when the issue has one or more attachments. */
  attachments?: SummaryAttachment[];
}

export interface IssueSummary {
  /** Ancestor chain from Project down to the requested issue. */
  nodes: SummaryNode[];
  workspace?: string;
  /** One-line mission paragraph from the vision doc's `## Mission` section. */
  mission?: string;
  supportingDocs?: SupportingDocs;
  inspirationApps?: InspirationApps;
}

/**
 * Agent-oriented lines listing attachment names, sizes, and on-disk paths.
 * `indent` prefixes every line (e.g. `"  "` under a summary node).
 */
export function formatAttachmentsSection(
  id: string,
  attachments: SummaryAttachment[],
  indent = "",
): string[] {
  if (attachments.length === 0) return [];
  return [
    `${indent}Attachments:`,
    ...attachments.map(
      (att) =>
        `${indent}  ${att.name} (${att.size} bytes) — ${attachmentPath(id, att.name)}`,
    ),
  ];
}

/**
 * Pure builder: walk `partOf` from `id` and attach structured fields.
 * Accepts any kind; a Branch/Epic/Project stops at that node rather than
 * inventing descendants.
 */
export function buildSummary(
  id: string,
  issues: Issue[],
  attachmentsOf: (
    id: string,
    kind: IssueKind,
  ) => SummaryAttachment[] | undefined = () => undefined,
  missionOf: (
    projectId: string,
    workspace: string | undefined,
    docs: SupportingDocs,
  ) => string | undefined = () => undefined,
): IssueSummary {
  const chain = ancestorChain(id, issues);
  const root = chain[0];
  const mission =
    root?.kind === "project" && root.supportingDocs
      ? missionOf(root.id, root.workspace, root.supportingDocs)
      : undefined;
  return {
    ...(root?.kind === "project" && root.workspace
      ? { workspace: root.workspace }
      : {}),
    ...(mission ? { mission } : {}),
    ...(root?.kind === "project" && root.supportingDocs
      ? { supportingDocs: root.supportingDocs }
      : {}),
    ...(root?.kind === "project" && root.inspirationApps
      ? { inspirationApps: root.inspirationApps }
      : {}),
    nodes: chain.map((issue) => {
      const attachments = attachmentsOf(issue.id, issue.kind);
      return {
        kind: issue.kind,
        id: issue.id,
        title: issue.title,
        ...(issue.kind === "task" && issue.noDiff
          ? { noDiff: true as const }
          : {}),
        ...(attachments ? { attachments } : {}),
      };
    }),
  };
}

function loadAttachments(
  id: string,
  kind: IssueKind,
): SummaryAttachment[] | undefined {
  if (!kindHas(kind, "attachments")) return undefined;
  const listed = listAttachments(id);
  if (listed.length === 0) return undefined;
  return listed.map(({ name, size }) => ({ name, size }));
}

function loadMission(
  projectId: string,
  workspace: string | undefined,
  docs: SupportingDocs,
): string | undefined {
  return readMissionParagraph(projectId, workspace, docs);
}

/** Load the on-disk graph and build a summary for `id`. */
export function summarize(id: string): IssueSummary {
  const { issues } = readAll();
  return buildSummary(id, issues, loadAttachments, loadMission);
}

/** Agent-oriented plain-text rendering of {@link IssueSummary}. */
export function formatSummary(summary: IssueSummary): string {
  const project = summary.nodes[0];
  if (!project || project.kind !== "project") {
    throw new IssueError("validation", "summary chain missing project root");
  }
  const lines: string[] = [
    `This is an issue in the ${project.title} Project. Here are the details:`,
    "",
  ];
  for (const node of summary.nodes) {
    lines.push(`${KIND_LABEL[node.kind]}: ${node.id} — ${node.title}`);
    if (node.kind === "project" && summary.workspace) {
      lines.push(`  Workspace: ${summary.workspace}`);
    }
    if (node.kind === "project" && summary.mission) {
      lines.push(`  Mission: ${summary.mission}`);
    }
    if (node.kind === "project" && summary.supportingDocs) {
      const line = formatSupportingDocsLine(summary.supportingDocs);
      if (line) lines.push(`  supportingDocs: ${line}`);
    }
    if (node.kind === "project" && summary.inspirationApps) {
      const line = formatInspirationAppsLine(summary.inspirationApps);
      if (line) lines.push(`  inspirationApps: ${line}`);
    }
    if (node.kind === "task" && node.noDiff) {
      lines.push(`  noDiff: true`);
    }
    if (node.attachments) {
      lines.push(...formatAttachmentsSection(node.id, node.attachments, "  "));
    }
  }
  lines.push("");
  lines.push(
    "For more details, try `issue <kind> view <id>` or `issue tree`.",
  );
  return lines.join("\n");
}
