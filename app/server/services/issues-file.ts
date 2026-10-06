import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { issuesDir } from "../config.js";
import { parseIssue, type Issue, type Problem } from "../schemas.js";

export interface ParsedIssue {
  issue?: Issue;
  problem?: Problem;
}

export function issueJsonPath(id: string): string {
  return join(issuesDir, id, "issue.json");
}

export function missingIssueJson(id: string): Problem {
  return { id, message: "missing issue.json" };
}

export function parseIssueText(id: string, text: string): ParsedIssue {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { problem: { id, message: `invalid issue.json: ${detail}` } };
  }
  const parsed = parseIssue(raw);
  if (!parsed.ok) {
    return { problem: { id, message: parsed.message } };
  }
  if (parsed.issue.id !== id) {
    return {
      issue: { ...parsed.issue, id },
      problem: {
        id,
        message: `issue.json id "${parsed.issue.id}" does not match directory name`,
      },
    };
  }
  return { issue: parsed.issue };
}

export function readIssueFile(id: string): ParsedIssue & { text?: string } {
  const jsonPath = issueJsonPath(id);
  if (!existsSync(jsonPath)) {
    return { problem: missingIssueJson(id) };
  }
  const text = readFileSync(jsonPath, "utf8");
  return { ...parseIssueText(id, text), text };
}
