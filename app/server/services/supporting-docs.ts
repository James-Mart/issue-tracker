import { existsSync, statSync } from "fs";
import type {
  Issue,
  IssuePatch,
  SupportingDocKey,
  SupportingDocRef,
  SupportingDocs,
} from "../schemas.js";
import { SUPPORTING_DOC_KEYS } from "../schemas.js";
import { IssueError } from "./errors.js";
import { listAttachments } from "./attachments.js";
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
