import { createHash } from "crypto";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { issuesDir } from "../config.js";
import type { Issue, IssueDetail, IssueRecord } from "../schemas.js";

function descriptionPath(id: string): string {
  return join(issuesDir, id, "description.md");
}

function jsonPath(id: string): string {
  return join(issuesDir, id, "issue.json");
}

export function readDescription(id: string): string {
  const path = descriptionPath(id);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

export function onDiskHasUnknownKeys(issue: Issue): boolean {
  const path = jsonPath(issue.id);
  if (!existsSync(path)) return false;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return false;
  }
  if (!raw || typeof raw !== "object") return false;
  const known = new Set(Object.keys(issue));
  return Object.keys(raw as Record<string, unknown>).some((key) => !known.has(key));
}

export function versionOf(jsonText: string, description: string): string {
  return createHash("sha1")
    .update(jsonText)
    .update("\0")
    .update(description)
    .digest("hex");
}

export function toIssueDetail(
  issue: Issue,
  jsonText: string,
  description: string,
): IssueDetail {
  return {
    ...(issue as IssueRecord),
    description,
    version: versionOf(jsonText, description),
  };
}
