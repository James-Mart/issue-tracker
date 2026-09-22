import { parse as parseYaml } from "yaml";
import { stackedStoryOrder } from "@server/order";
import { isExportDraftName } from "./export-tab";

const DRAFT_PREFIX = "github-export-";
const DRAFT_SUFFIX = ".md";

/** Issue id encoded in a reserved basename `github-export-<id>.md`. */
export function exportDraftIssueId(name: string): string | null {
  if (!name.startsWith(DRAFT_PREFIX) || !name.endsWith(DRAFT_SUFFIX)) return null;
  const id = name.slice(DRAFT_PREFIX.length, -DRAFT_SUFFIX.length);
  return id.length > 0 ? id : null;
}

/** YAML `title` from a reserved draft. Null when the frontmatter has none. */
export function exportDraftTitle(content: string): string | null {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) return null;
  const end = content.indexOf("\n---", 4);
  if (end === -1) return null;
  let parsed: unknown;
  try {
    parsed = parseYaml(content.slice(4, end));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const title = (parsed as { title?: unknown }).title;
  if (typeof title !== "string" || title.length === 0) return null;
  return title;
}

/** Markdown body after the title frontmatter. The raw file stays for Edit. */
export function exportDraftBody(content: string): string {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) return content;
  const end = content.indexOf("\n---", 4);
  if (end === -1) return content;
  return content.slice(end + 4).replace(/^\r?\n/, "");
}

export function exportDraftKindLabel(
  kind: string | undefined,
): "Epic" | "Story" | null {
  if (kind === "epic") return "Epic";
  if (kind === "story") return "Story";
  return null;
}

export type ExportDraftOrderIssue = {
  id: string;
  kind: string;
  order: number;
  partOf?: string;
  stackedOn?: string;
};

/**
 * Reserved drafts in tracker order: the root file, then Stories in
 * `stackedStoryOrder`. Names that are not that root or one of its Stories
 * follow, sorted by basename.
 */
export function orderExportDraftNames(
  root: { id: string; kind: string },
  issues: readonly ExportDraftOrderIssue[],
  names: readonly string[],
): string[] {
  const drafts = names.filter(isExportDraftName);
  const byIssue = new Map<string, string>();
  for (const name of drafts) {
    const id = exportDraftIssueId(name);
    if (!id || byIssue.has(id)) continue;
    byIssue.set(id, name);
  }

  const ordered: string[] = [];
  const used = new Set<string>();
  const take = (id: string) => {
    const name = byIssue.get(id);
    if (!name || used.has(name)) return;
    used.add(name);
    ordered.push(name);
  };

  if (root.kind === "story") {
    take(root.id);
  } else if (root.kind === "epic") {
    take(root.id);
    const stories = stackedStoryOrder(
      issues.filter(
        (issue) => issue.kind === "story" && issue.partOf === root.id,
      ),
    );
    for (const story of stories) take(story.id);
  }

  const rest = drafts.filter((name) => !used.has(name)).sort();
  return [...ordered, ...rest];
}

export function exportRunStripLabel(input: {
  activeRun: boolean;
  outcomePending: boolean;
  latestFailed: boolean;
  draftCount: number;
}): string {
  if (input.activeRun) return "Rewrite running";
  if (input.outcomePending) return "Export session";
  if (input.latestFailed) return "Export failed";
  const noun = input.draftCount === 1 ? "draft" : "drafts";
  return `Export complete — ${input.draftCount} ${noun} attached`;
}
