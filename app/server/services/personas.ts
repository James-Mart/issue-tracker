import type { Issue, IssuePatch, PersonaEntry, Personas } from "../schemas.js";
import { formatZodError, personaEntrySchema, personasSchema } from "../schemas.js";
import { IssueError } from "./errors.js";

export function parsePersonaEntry(raw: unknown): PersonaEntry {
  const result = personaEntrySchema.safeParse(raw);
  if (!result.success) {
    throw new IssueError(
      "validation",
      formatZodError(result.error, "invalid persona entry"),
    );
  }
  return result.data;
}

export function parsePersonas(raw: unknown): Personas {
  const result = personasSchema.safeParse(raw);
  if (!result.success) {
    throw new IssueError(
      "validation",
      formatZodError(result.error, "invalid personas"),
    );
  }
  return result.data;
}

export function validatePersonas(personas: Personas): void {
  parsePersonas(personas);
}

export function validatePersonasPatch(existing: Issue, patch: IssuePatch): void {
  if (!("personas" in patch)) return;
  if (existing.kind !== "project") {
    throw new IssueError("validation", "personas is only valid on a project");
  }
  const { personas } = patch;
  if (personas === undefined) return;
  validatePersonas(personas);
}

export function formatPersonasLine(personas: Personas): string {
  return personas
    .map((entry: PersonaEntry) => `${entry.name} — ${entry.description}`)
    .join(", ");
}
