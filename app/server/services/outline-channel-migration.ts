import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { issuesDir } from "../config.js";
import type { OutlineSessionRole } from "../schemas.js";
import { storedConversationMetas } from "./conversation-ids.js";
import { persistConversationMeta } from "./conversation-meta-index.js";
import { firstPromptText } from "./conversation-transcript-seq.js";
import { forEachOnDiskIssue } from "./scan-disk.js";

const MIGRATION_FLAG = ".outline-channels-migrated";

/**
 * How each decomposition-channel session's first prompt opened while every
 * outline session ran on `planning`. These are the stored texts, not the
 * current prompt builders, so a later wording change cannot misfile them.
 */
const LEGACY_PROMPT_LEADS: readonly {
  role: Exclude<OutlineSessionRole, "planner">;
  lead: (outlineId: string) => string;
}[] = [
  { role: "decomposer", lead: (id) => `Decompose ${id} in the issue tracker. ` },
  { role: "reconcile", lead: (id) => `Reconcile ${id} in the issue tracker. ` },
  {
    role: "check",
    lead: (id) => `Check ${id} against review feedback in the issue tracker. `,
  },
];

function flagPath(): string {
  return join(issuesDir, MIGRATION_FLAG);
}

function startedRole(
  conversationId: string,
  outlineId: string,
): OutlineSessionRole | undefined {
  const text = firstPromptText(conversationId);
  if (text === undefined) return undefined;
  return LEGACY_PROMPT_LEADS.find(({ lead }) => text.startsWith(lead(outlineId)))
    ?.role;
}

/**
 * One-time: move outline sessions started as decomposer, reconcile, or
 * outline check from `planning` to `decomposition` with that role, archived
 * sessions included. Other outline sessions stay on `planning`.
 */
export function ensureOutlineChannelsMigrated(): void {
  if (existsSync(flagPath())) return;

  const outlineIds = new Set<string>();
  for (const { issue } of forEachOnDiskIssue()) {
    if (issue.kind === "outline") outlineIds.add(issue.id);
  }
  for (const meta of storedConversationMetas()) {
    const { issueId } = meta;
    if (meta.channel !== "planning" || !issueId || !outlineIds.has(issueId)) continue;
    const role = startedRole(meta.id, issueId);
    if (!role) continue;
    persistConversationMeta({ ...meta, channel: "decomposition", outlineRole: role });
  }

  mkdirSync(issuesDir, { recursive: true });
  writeFileSync(flagPath(), "");
}
