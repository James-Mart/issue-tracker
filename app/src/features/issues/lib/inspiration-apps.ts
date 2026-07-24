import {
  formatZodError,
  inspirationAppsSchema,
  type InspirationAppEntry,
  type InspirationApps,
} from "@server/schemas";

export type InspirationAppDraft = {
  key: string;
  name: string;
  url: string;
  description: string;
};

export function inspirationAppDraftsFromIssue(
  apps: InspirationApps | undefined,
): InspirationAppDraft[] {
  return (apps ?? []).map((entry) => ({
    key: entry.name,
    name: entry.name,
    url: entry.url,
    description: entry.description,
  }));
}

export function newInspirationAppDraft(): InspirationAppDraft {
  return {
    key: `new-${crypto.randomUUID()}`,
    name: "",
    url: "",
    description: "",
  };
}

export function normalizeInspirationApp(
  draft: InspirationAppDraft,
): InspirationAppEntry {
  return {
    name: draft.name.trim(),
    url: draft.url.trim(),
    description: draft.description.trim(),
  };
}

export function inspirationAppsEqual(
  a: InspirationApps | undefined,
  b: InspirationApps,
): boolean {
  return JSON.stringify(a ?? []) === JSON.stringify(b);
}

/** True when name and url are present (description may be empty). */
export function isInspirationAppDraftReady(
  draft: InspirationAppDraft,
): boolean {
  return Boolean(draft.name.trim() && draft.url.trim());
}

/**
 * Build the list to persist. Incomplete drafts keep the prior entry when
 * `draft.key` matches a persisted name; otherwise they are skipped (new rows
 * use synthetic keys absent from `byKey`).
 */
export function inspirationAppsFromDraftsPreservingIncomplete(
  drafts: InspirationAppDraft[],
  persisted: InspirationApps | undefined,
): InspirationApps {
  const byKey = new Map((persisted ?? []).map((entry) => [entry.name, entry]));
  const next: InspirationAppEntry[] = [];
  for (const draft of drafts) {
    if (!isInspirationAppDraftReady(draft)) {
      const prev = byKey.get(draft.key);
      if (prev) next.push(prev);
      continue;
    }
    next.push(normalizeInspirationApp(draft));
  }
  return next;
}

export type InspirationAppsSaveResult =
  | { ok: true; apps: InspirationApps | null }
  | { ok: false; error: string };

/**
 * Derive a committable list (preserving incomplete rows), validate with the
 * shared schema, and return normalized apps — or null when unchanged.
 */
export function planInspirationAppsSave(
  persisted: InspirationApps | undefined,
  drafts: InspirationAppDraft[],
): InspirationAppsSaveResult {
  const apps = inspirationAppsFromDraftsPreservingIncomplete(drafts, persisted);
  const parsed = inspirationAppsSchema.safeParse(apps);
  if (!parsed.success) {
    return {
      ok: false,
      error: formatZodError(parsed.error, "invalid inspirationApps"),
    };
  }
  if (inspirationAppsEqual(persisted, parsed.data)) {
    return { ok: true, apps: null };
  }
  return { ok: true, apps: parsed.data };
}
