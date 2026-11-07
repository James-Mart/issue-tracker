const OVERVIEW_LENSES = ["structure", "overview"] as const;

type OverviewLens = (typeof OVERVIEW_LENSES)[number];

const DEFAULT_OVERVIEW_LENS: OverviewLens = "structure";

function isOverviewLens(value: string): value is OverviewLens {
  return (OVERVIEW_LENSES as readonly string[]).includes(value);
}

/**
 * Parse `lens` query value; unknown or absent → Structure.
 * Legacy `flow` is not a lens id and resolves the same way, so old links
 * and bookmarks keep working.
 */
export function parseOverviewLens(value: string | null): OverviewLens {
  if (value != null && isOverviewLens(value)) return value;
  return DEFAULT_OVERVIEW_LENS;
}
