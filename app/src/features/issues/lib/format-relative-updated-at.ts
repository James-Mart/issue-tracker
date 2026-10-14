type ElapsedUnit = "s" | "m" | "h" | "d";

/** Signed rounding, then the absolute count. Half-units follow `Math.round`. */
function elapsedParts(diffSec: number): { abs: number; unit: ElapsedUnit } {
  const absSec = Math.abs(diffSec);
  if (absSec < 60) return { abs: absSec, unit: "s" };
  const diffMin = Math.round(diffSec / 60);
  if (Math.abs(diffMin) < 60) return { abs: Math.abs(diffMin), unit: "m" };
  const diffHour = Math.round(diffSec / 3600);
  if (Math.abs(diffHour) < 24) return { abs: Math.abs(diffHour), unit: "h" };
  return { abs: Math.abs(Math.round(diffSec / 86400)), unit: "d" };
}

/**
 * Unsigned elapsed time (`12m`). A value that is not a time stays blank so
 * one bad stamp does not replace the row.
 */
export function formatElapsedCompact(
  iso: string,
  nowMs: number = Date.now(),
): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const diffSec = Math.round((then - nowMs) / 1000);
  if (diffSec >= 0) return "0s";
  const { abs, unit } = elapsedParts(diffSec);
  return `${abs}${unit}`;
}

/** Compact relative time for session refs (e.g. `2h ago`). */
export function formatRelativeUpdatedAt(
  iso: string,
  nowMs: number = Date.now(),
): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffSec = Math.round((then - nowMs) / 1000);
  if (diffSec === 0) return "0s ago";
  const { abs, unit } = elapsedParts(diffSec);
  if (diffSec < 0) return `${abs}${unit} ago`;
  return `in ${abs}${unit}`;
}

