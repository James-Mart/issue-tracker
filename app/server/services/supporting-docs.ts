import { existsSync, readFileSync, statSync } from "fs";
import type {
  Issue,
  IssuePatch,
  SupportingDocKey,
  SupportingDocRef,
  SupportingDocs,
} from "../schemas.js";
import { SUPPORTING_DOC_KEYS } from "../schemas.js";
import { IssueError } from "./errors.js";
import { attachmentPath, listAttachments } from "./attachments.js";
import { resolveUnderWorkspace } from "./workspace.js";

export const WELL_KNOWN_SUPPORTING_DOC_BASENAMES: Record<
  SupportingDocKey,
  string
> = {
  vision: "vision.md",
  codingStandards: "coding-standards.md",
  designSystem: "design-system.md",
};

export function isSupportingDocKey(value: string): value is SupportingDocKey {
  return (SUPPORTING_DOC_KEYS as readonly string[]).includes(value);
}

function validateRef(
  projectId: string,
  workspace: string | undefined,
  ref: SupportingDocRef,
): void {
  if (ref.type === "attachment") {
    const names = new Set(listAttachments(projectId).map((a) => a.name));
    if (!names.has(ref.name)) {
      throw new IssueError(
        "validation",
        `supportingDocs attachment "${ref.name}" is not attached on "${projectId}"`,
      );
    }
    return;
  }
  if (!workspace) {
    throw new IssueError(
      "validation",
      "supportingDocs workspace refs require the Project workspace to be set",
    );
  }
  const resolved = resolveUnderWorkspace(workspace, ref.path);
  if (!existsSync(resolved) || !statSync(resolved).isFile()) {
    throw new IssueError(
      "validation",
      `supportingDocs workspace file does not exist: ${ref.path}`,
    );
  }
}

export function validateSupportingDocs(
  projectId: string,
  workspace: string | undefined,
  docs: SupportingDocs,
): void {
  for (const key of SUPPORTING_DOC_KEYS) {
    const ref = docs[key];
    if (ref) validateRef(projectId, workspace, ref);
  }
}

export function validateSupportingDocsPatch(
  existing: Issue,
  patch: IssuePatch,
): void {
  if (!("supportingDocs" in patch)) return;
  if (existing.kind !== "project") {
    throw new IssueError(
      "validation",
      "supportingDocs is only valid on a project",
    );
  }
  const { supportingDocs } = patch;
  if (supportingDocs === null || supportingDocs === undefined) return;
  validateSupportingDocs(existing.id, existing.workspace, supportingDocs);
}

export function resolveSupportingDocPath(
  projectId: string,
  workspace: string | undefined,
  ref: SupportingDocRef,
): string | undefined {
  if (ref.type === "attachment") {
    return attachmentPath(projectId, ref.name);
  }
  if (!workspace) return undefined;
  return resolveUnderWorkspace(workspace, ref.path);
}

function extractMissionParagraph(content: string): string | undefined {
  const lines = content.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^## Mission\s*$/.test(lines[i]!)) {
      start = i + 1;
      break;
    }
  }
  if (start === -1) return undefined;

  const bodyLines: string[] = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^#{1,2} /.test(line)) break;
    bodyLines.push(line);
  }

  const text = bodyLines.join("\n").trim().replace(/\s+/g, " ");
  return text || undefined;
}

export function readMissionParagraph(
  projectId: string,
  workspace: string | undefined,
  docs: SupportingDocs,
): string | undefined {
  const ref = docs.vision;
  if (!ref) return undefined;

  const path = resolveSupportingDocPath(projectId, workspace, ref);
  if (!path) return undefined;

  try {
    if (!existsSync(path) || !statSync(path).isFile()) return undefined;
    return extractMissionParagraph(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

export function formatSupportingDocsLine(docs: SupportingDocs): string {
  const parts: string[] = [];
  for (const key of SUPPORTING_DOC_KEYS) {
    const ref = docs[key];
    if (!ref) continue;
    if (ref.type === "attachment") {
      parts.push(`${key}=attachment:${ref.name}`);
    } else {
      parts.push(`${key}=workspace:${ref.path}`);
    }
  }
  return parts.join(", ");
}
