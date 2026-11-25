// Slug-safe = the shape `slugify()` produces: lowercase alphanumerics in
// hyphen-separated groups, no leading/trailing/doubled hyphen. Kept at the
// server root so schemas and services share one source of truth without
// schemas depending on the services tree.
export const SLUG_PATTERN = "[a-z0-9]+(?:-[a-z0-9]+)*";
export const SLUG_RE = new RegExp(`^${SLUG_PATTERN}$`);

export function isSlugSafe(value: string): boolean {
  return SLUG_RE.test(value);
}

/** Refuse `value` unless it is a slug. `label` names the value in the error. */
export function assertSlug(value: string, label: string): void {
  if (!isSlugSafe(value)) {
    throw new Error(`${label} must be a slug, got ${JSON.stringify(value)}`);
  }
}
