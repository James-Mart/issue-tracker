/** Compact relative time for session refs (e.g. `2h ago`). */
export function formatRelativeUpdatedAt(
  iso: string,
  nowMs: number = Date.now(),
): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffSec = Math.round((then - nowMs) / 1000);
  const absSec = Math.abs(diffSec);
  if (absSec < 60) return formatRelativeUnit(diffSec, "s");
  const diffMin = Math.round(diffSec / 60);
  if (Math.abs(diffMin) < 60) return formatRelativeUnit(diffMin, "m");
  const diffHour = Math.round(diffSec / 3600);
  if (Math.abs(diffHour) < 24) return formatRelativeUnit(diffHour, "h");
  const diffDay = Math.round(diffSec / 86400);
  return formatRelativeUnit(diffDay, "d");
}

function formatRelativeUnit(value: number, unit: "s" | "m" | "h" | "d"): string {
  const abs = Math.abs(value);
  if (value < 0) return `${abs}${unit} ago`;
  if (value > 0) return `in ${abs}${unit}`;
  return `0${unit} ago`;
}
