import type { CommentSource } from "@server/schemas";

/**
 * No inclusion event yet: a GitHub-mirrored root stays out of the next
 * submission, and every other root is in.
 */
export function includedWhenUnset(source: CommentSource | undefined): boolean {
  return source?.kind !== "github";
}
