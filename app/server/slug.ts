// Slug-safe = the shape `slugify()` produces: lowercase alphanumerics in
// hyphen-separated groups, no leading/trailing/doubled hyphen. Kept at the
// server root so schemas and services share one source of truth without
// schemas depending on the services tree.
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isSlugSafe(value: string): boolean {
  return SLUG_RE.test(value);
}
