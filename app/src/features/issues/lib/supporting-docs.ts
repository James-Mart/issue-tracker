import {
  SUPPORTING_DOC_KEYS,
  type SupportingDocKey,
  type SupportingDocRef,
  type SupportingDocs,
} from "@server/schemas";
import { attachmentsApiPath } from "./attachments";

export const SUPPORTING_DOC_KEY_LABELS: Record<SupportingDocKey, string> = {
  vision: "Vision",
  codingStandards: "Coding standards",
  designSystem: "Design system",
};

export type SupportingDocPreviewFormat = "md" | "html";

export type SupportingDocPreviewTab = {
  key: SupportingDocKey;
  label: string;
  ref: SupportingDocRef;
  format: SupportingDocPreviewFormat;
};

/** Basename or path the ref points at (for extension checks). */
export function supportingDocTarget(ref: SupportingDocRef): string {
  return ref.type === "attachment" ? ref.name : ref.path;
}

export function supportingDocPreviewFormat(
  ref: SupportingDocRef,
): SupportingDocPreviewFormat | null {
  const target = supportingDocTarget(ref).toLowerCase();
  if (target.endsWith(".md")) return "md";
  if (target.endsWith(".html")) return "html";
  return null;
}

/** Preview tabs for set docs whose target ends in `.md` or `.html`. */
export function previewableSupportingDocs(
  docs: SupportingDocs | undefined,
): SupportingDocPreviewTab[] {
  if (!docs) return [];
  const tabs: SupportingDocPreviewTab[] = [];
  for (const key of SUPPORTING_DOC_KEYS) {
    const ref = docs[key];
    if (!ref) continue;
    const format = supportingDocPreviewFormat(ref);
    if (!format) continue;
    tabs.push({
      key,
      label: SUPPORTING_DOC_KEY_LABELS[key],
      ref,
      format,
    });
  }
  return tabs;
}

/**
 * Workspace file URL with per-segment encoding so `/` remains a path separator
 * (needed for iframe-relative assets).
 */
export function workspaceFileApiPath(
  projectId: string,
  relativePath: string,
): string {
  const encoded = relativePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `/api/projects/${encodeURIComponent(projectId)}/workspace/${encoded}`;
}

/** HTTP URL used to load a supporting-doc body (md fetch or html iframe src). */
export function supportingDocContentUrl(
  projectId: string,
  ref: SupportingDocRef,
): string {
  if (ref.type === "attachment") {
    return attachmentsApiPath(projectId, ref.name);
  }
  return workspaceFileApiPath(projectId, ref.path);
}

export type SupportingDocMode = "absent" | "attachment" | "workspace";

export type SupportingDocDraft =
  | { mode: "absent" }
  | { mode: "attachment"; name: string }
  | { mode: "workspace"; path: string };

export type SupportingDocsDraft = Record<SupportingDocKey, SupportingDocDraft>;

export function emptySupportingDocDraft(): SupportingDocDraft {
  return { mode: "absent" };
}

export function supportingDocDraftForMode(
  mode: SupportingDocMode,
): SupportingDocDraft {
  switch (mode) {
    case "absent":
      return { mode: "absent" };
    case "attachment":
      return { mode: "attachment", name: "" };
    case "workspace":
      return { mode: "workspace", path: "" };
  }
}

export function supportingDocDraftFromRef(
  ref: SupportingDocRef | undefined,
): SupportingDocDraft {
  if (!ref) return emptySupportingDocDraft();
  if (ref.type === "attachment") {
    return { mode: "attachment", name: ref.name };
  }
  return { mode: "workspace", path: ref.path };
}

export function supportingDocsDraftFromIssue(
  docs: SupportingDocs | undefined,
): SupportingDocsDraft {
  const draft = {} as SupportingDocsDraft;
  for (const key of SUPPORTING_DOC_KEYS) {
    draft[key] = supportingDocDraftFromRef(docs?.[key]);
  }
  return draft;
}

export function formatSupportingDocRef(ref: SupportingDocRef): string {
  return ref.type === "attachment"
    ? `attachment:${ref.name}`
    : `workspace:${ref.path}`;
}

export function supportingDocRefFromDraft(
  draft: SupportingDocDraft,
): SupportingDocRef | undefined {
  if (draft.mode === "absent") return undefined;
  if (draft.mode === "attachment") {
    const name = draft.name.trim();
    if (!name) return undefined;
    return { type: "attachment", name };
  }
  const path = draft.path.trim();
  if (!path) return undefined;
  return { type: "workspace", path };
}

/** True when the draft is absent or has a resolvable pointer. */
export function isSupportingDocDraftReady(draft: SupportingDocDraft): boolean {
  return (
    draft.mode === "absent" || supportingDocRefFromDraft(draft) !== undefined
  );
}

/** Build stored `supportingDocs` (or `null` to clear) from edit drafts. */
export function supportingDocsFromDraft(
  draft: SupportingDocsDraft,
): SupportingDocs | null {
  const next: SupportingDocs = {};
  for (const key of SUPPORTING_DOC_KEYS) {
    const ref = supportingDocRefFromDraft(draft[key]);
    if (ref) next[key] = ref;
  }
  return Object.keys(next).length === 0 ? null : next;
}

/**
 * Like `supportingDocsFromDraft`, but incomplete (non-absent empty) keys keep
 * their persisted pointer so mid-edit rows do not clear siblings on save.
 */
export function supportingDocsFromDraftPreservingIncomplete(
  draft: SupportingDocsDraft,
  persisted: SupportingDocs | undefined,
): SupportingDocs | null {
  const next: SupportingDocs = {};
  for (const key of SUPPORTING_DOC_KEYS) {
    const d = draft[key];
    if (!isSupportingDocDraftReady(d)) {
      const prev = persisted?.[key];
      if (prev) next[key] = prev;
      continue;
    }
    const ref = supportingDocRefFromDraft(d);
    if (ref) next[key] = ref;
  }
  return Object.keys(next).length === 0 ? null : next;
}

export function supportingDocsEqual(
  a: SupportingDocs | null | undefined,
  b: SupportingDocs | null | undefined,
): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}
