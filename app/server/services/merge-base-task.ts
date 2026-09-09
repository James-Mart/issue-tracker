import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { IssueError } from "./errors.js";

const servicesDir = fileURLToPath(new URL(".", import.meta.url));
const templatePath = join(
  servicesDir,
  "..",
  "templates",
  "update-from-merge-base.md",
);

const PLACEHOLDER_PATTERN = /\{\{(\w+)\}\}/;

function requireRef(name: string, value: string): void {
  if (value) return;
  throw new IssueError(
    "validation",
    `merge-base task description requires ${name}`,
  );
}

export function renderMergeBaseTaskDescription({
  branchName,
  mergeBase,
}: {
  branchName: string;
  mergeBase: string;
}): string {
  requireRef("branchName", branchName);
  requireRef("mergeBase", mergeBase);

  const template = readFileSync(templatePath, "utf8");
  const rendered = template
    .replaceAll("{{branchName}}", branchName)
    .replaceAll("{{mergeBase}}", mergeBase);

  const leftover = rendered.match(PLACEHOLDER_PATTERN);
  if (leftover) {
    throw new IssueError(
      "validation",
      `unsubstituted placeholder in merge-base task template: ${leftover[0]}`,
    );
  }

  return rendered;
}
