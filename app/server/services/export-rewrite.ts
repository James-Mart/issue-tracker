import { stringify } from "yaml";
import type { IssueKind } from "../schemas.js";
import { bySequence, stackedStoryOrder } from "../order.js";

export type ExportDraftFile = {
  name: string;
  content: string;
};

/** Fields the rewrite reads. Other issue fields are ignored. */
export type ExportRewriteNode = {
  id: string;
  kind: IssueKind;
  title: string;
  description: string;
  order: number;
  partOf?: string;
  stackedOn?: string;
};

export function exportDraftName(id: string): string {
  return `github-export-${id}.md`;
}

function frontmatter(title: string): string {
  const yaml = stringify({ title }).trimEnd();
  return `---\n${yaml}\n---\n`;
}

function trimTrailingNewlines(text: string): string {
  return text.replace(/\n+$/, "");
}

function draft(title: string, body: string): string {
  const prose = trimTrailingNewlines(body);
  return prose.length > 0 ? `${frontmatter(title)}${prose}\n` : frontmatter(title);
}

function storyFile(
  story: ExportRewriteNode,
  tasks: readonly ExportRewriteNode[],
): ExportDraftFile {
  const parts: string[] = [];
  const description = trimTrailingNewlines(story.description);
  if (description.length > 0) parts.push(description);
  for (const task of [...tasks].sort(bySequence)) {
    const taskDescription = trimTrailingNewlines(task.description);
    parts.push(
      taskDescription.length > 0
        ? `## ${task.title}\n\n${taskDescription}`
        : `## ${task.title}`,
    );
  }
  return {
    name: exportDraftName(story.id),
    content: draft(story.title, parts.join("\n\n")),
  };
}

function epicFile(
  epic: ExportRewriteNode,
  stories: readonly ExportRewriteNode[],
): ExportDraftFile {
  const parts: string[] = [];
  const description = trimTrailingNewlines(epic.description);
  if (description.length > 0) parts.push(description);
  if (stories.length > 0) {
    parts.push(stories.map((story) => `- [ ] ${story.title}`).join("\n"));
  }
  return {
    name: exportDraftName(epic.id),
    content: draft(epic.title, parts.join("\n\n")),
  };
}

/**
 * Draft files for an Epic (epic file plus one file per contained Story) or
 * a Story (one file). Story order is tracker order (`stackedStoryOrder`).
 * Task order under a Story is stored `order`.
 */
export function exportDraftFiles(
  rootId: string,
  nodes: readonly ExportRewriteNode[],
): ExportDraftFile[] {
  const root = nodes.find((node) => node.id === rootId);
  if (!root) throw new Error(`unknown issue "${rootId}"`);

  if (root.kind === "story") {
    const tasks = nodes.filter(
      (node) => node.kind === "task" && node.partOf === root.id,
    );
    return [storyFile(root, tasks)];
  }

  if (root.kind === "epic") {
    const stories = stackedStoryOrder(
      nodes.filter(
        (node) => node.kind === "story" && node.partOf === root.id,
      ),
    );
    return [
      epicFile(root, stories),
      ...stories.map((story) =>
        storyFile(
          story,
          nodes.filter(
            (node) => node.kind === "task" && node.partOf === story.id,
          ),
        ),
      ),
    ];
  }

  throw new Error(
    `issue "${rootId}" is not an Epic or project-level Story`,
  );
}
