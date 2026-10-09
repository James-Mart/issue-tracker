/** Per-project overview lens ids, persisted as `?lens=`. */
export const OVERVIEW_LENSES = ["structure", "overview"] as const;

export type OverviewLens = (typeof OVERVIEW_LENSES)[number];

export const DEFAULT_OVERVIEW_LENS: OverviewLens = "structure";

const OVERVIEW_LENS_LABELS: Record<OverviewLens, string> = {
  structure: "Structure",
  overview: "Overview",
};

export const OVERVIEW_LENS_OPTIONS = OVERVIEW_LENSES.map((id) => ({
  id,
  label: OVERVIEW_LENS_LABELS[id],
}));

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

/** Non-default lenses add their label; Structure (the default) has none. */
export function overviewLensTabSuffix(lens: OverviewLens): string | undefined {
  if (lens === DEFAULT_OVERVIEW_LENS) return undefined;
  return OVERVIEW_LENS_LABELS[lens];
}

