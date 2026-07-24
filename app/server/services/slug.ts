import { SLUG_RE, isSlugSafe } from "../slug.js";

export { SLUG_RE, isSlugSafe };

export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "issue";
}

/** Prefer `base+suffix`; on collision use `{base}-{n}{suffix}` (smallest n ≥ 2). */
export function firstFreeSuffixedName(
  base: string,
  suffix: string,
  taken: Iterable<string>,
): string {
  const existing = taken instanceof Set ? taken : new Set(taken);
  const preferred = `${base}${suffix}`;
  if (!existing.has(preferred)) return preferred;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}${suffix}`;
    if (!existing.has(candidate)) return candidate;
  }
}

export function uniqueSlug(title: string, taken: Iterable<string>): string {
  return firstFreeSuffixedName(slugify(title), "", taken);
}
