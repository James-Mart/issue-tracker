import {
  formatZodError,
  personasSchema,
  type PersonaEntry,
  type Personas,
} from "@server/schemas";

export type PersonaDraft = {
  key: string;
  name: string;
  description: string;
};

export function personaDraftsFromIssue(
  personas: Personas | undefined,
): PersonaDraft[] {
  return (personas ?? []).map((entry) => ({
    key: entry.name,
    name: entry.name,
    description: entry.description,
  }));
}

export function newPersonaDraft(): PersonaDraft {
  return {
    key: `new-${crypto.randomUUID()}`,
    name: "",
    description: "",
  };
}

export function normalizePersona(draft: PersonaDraft): PersonaEntry {
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
  };
}

export function personasEqual(
  a: Personas | undefined,
  b: Personas,
): boolean {
  return JSON.stringify(a ?? []) === JSON.stringify(b);
}

/** True when name is present (description may be empty). */
export function isPersonaDraftReady(draft: PersonaDraft): boolean {
  return Boolean(draft.name.trim());
}

/**
 * Build the list to persist. Incomplete drafts keep the prior entry when
 * `draft.key` matches a persisted name; otherwise they are skipped (new rows
 * use synthetic keys absent from `byKey`).
 */
export function personasFromDraftsPreservingIncomplete(
  drafts: PersonaDraft[],
  persisted: Personas | undefined,
): Personas {
  const byKey = new Map((persisted ?? []).map((entry) => [entry.name, entry]));
  const next: PersonaEntry[] = [];
  for (const draft of drafts) {
    if (!isPersonaDraftReady(draft)) {
      const prev = byKey.get(draft.key);
      if (prev) next.push(prev);
      continue;
    }
    next.push(normalizePersona(draft));
  }
  return next;
}

export type PersonasSaveResult =
  | { ok: true; personas: Personas | null }
  | { ok: false; error: string };

/**
 * Derive a committable list (preserving incomplete rows), validate with the
 * shared schema, and return normalized personas — or null when unchanged.
 */
export function planPersonasSave(
  persisted: Personas | undefined,
  drafts: PersonaDraft[],
): PersonasSaveResult {
  const personas = personasFromDraftsPreservingIncomplete(drafts, persisted);
  const parsed = personasSchema.safeParse(personas);
  if (!parsed.success) {
    return {
      ok: false,
      error: formatZodError(parsed.error, "invalid personas"),
    };
  }
  if (personasEqual(persisted, parsed.data)) {
    return { ok: true, personas: null };
  }
  return { ok: true, personas: parsed.data };
}
