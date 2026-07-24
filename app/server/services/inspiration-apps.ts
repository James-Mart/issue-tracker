import type { InspirationAppEntry, InspirationApps, Issue, IssuePatch } from "../schemas.js";
import {
  formatZodError,
  inspirationAppEntrySchema,
  inspirationAppsSchema,
} from "../schemas.js";
import { IssueError } from "./errors.js";

export function parseInspirationAppEntry(raw: unknown): InspirationAppEntry {
  const result = inspirationAppEntrySchema.safeParse(raw);
  if (!result.success) {
    throw new IssueError(
      "validation",
      formatZodError(result.error, "invalid inspiration app entry"),
    );
  }
  return result.data;
}

export function parseInspirationApps(raw: unknown): InspirationApps {
  const result = inspirationAppsSchema.safeParse(raw);
  if (!result.success) {
    throw new IssueError(
      "validation",
      formatZodError(result.error, "invalid inspirationApps"),
    );
  }
  return result.data;
}

export function validateInspirationApps(apps: InspirationApps): void {
  parseInspirationApps(apps);
}

export function validateInspirationAppsPatch(
  existing: Issue,
  patch: IssuePatch,
): void {
  if (!("inspirationApps" in patch)) return;
  if (existing.kind !== "project") {
    throw new IssueError(
      "validation",
      "inspirationApps is only valid on a project",
    );
  }
  const { inspirationApps } = patch;
  if (inspirationApps === undefined) return;
  validateInspirationApps(inspirationApps);
}

export function formatInspirationAppsLine(apps: InspirationApps): string {
  return apps
    .map(
      (entry: InspirationAppEntry) =>
        `${entry.name} — ${entry.url} — ${entry.description}`,
    )
    .join(", ");
}
