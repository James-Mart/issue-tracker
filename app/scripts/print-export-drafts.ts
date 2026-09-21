#!/usr/bin/env -S npx tsx
// Print `{ files }` for PUT /api/issues/:id/export-drafts.
// Reads the root through the same issue view service as `issue view`.

import { refreshStorePathsFromEnv } from "../server/config.js";
import { IssueError } from "../server/services/errors.js";
import {
  exportDraftFiles,
  type ExportRewriteNode,
} from "../server/services/export-rewrite.js";
import { list, read } from "../server/services/issues.js";
import type { IssueDetail } from "../server/schemas.js";

refreshStorePathsFromEnv();

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function toNode(detail: IssueDetail): ExportRewriteNode {
  const node: ExportRewriteNode = {
    id: detail.id,
    kind: detail.kind,
    title: detail.title,
    description: detail.description,
    order: detail.order,
  };
  if ("partOf" in detail) node.partOf = detail.partOf;
  if (detail.kind === "story" && detail.stackedOn) {
    node.stackedOn = detail.stackedOn;
  }
  return node;
}

const rootId = process.argv[2]?.trim();
if (!rootId) fail("usage: print-export-drafts <rootId>");

try {
  const root = read(rootId);
  if (root.kind === "epic") {
    if (root.archived) {
      fail(
        `issue "${rootId}" is not an unarchived Epic or project-level Story`,
      );
    }
  } else if (root.kind === "story") {
    const parent = read(root.partOf);
    if (parent.kind !== "project" || root.archived) {
      fail(
        `issue "${rootId}" is not an unarchived Epic or project-level Story`,
      );
    }
  } else {
    fail(
      `issue "${rootId}" is not an unarchived Epic or project-level Story`,
    );
  }

  const { issues } = list();
  const ids = new Set<string>([root.id]);
  if (root.kind === "epic") {
    for (const issue of issues) {
      if (issue.kind === "story" && issue.partOf === root.id) ids.add(issue.id);
    }
  }
  for (const issue of issues) {
    if (issue.kind === "task" && ids.has(issue.partOf)) ids.add(issue.id);
  }

  const files = exportDraftFiles(root.id, [...ids].map((id) => toNode(read(id))));
  process.stdout.write(`${JSON.stringify({ files })}\n`);
} catch (err) {
  if (err instanceof IssueError) fail(err.message);
  throw err;
}
