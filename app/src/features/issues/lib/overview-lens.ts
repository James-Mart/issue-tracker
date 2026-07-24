/** Per-project overview lens ids, persisted as `?lens=`. */
export const OVERVIEW_LENSES = ["flow", "structure", "dependencies"] as const;

export type OverviewLens = (typeof OVERVIEW_LENSES)[number];

export const DEFAULT_OVERVIEW_LENS: OverviewLens = "flow";

const OVERVIEW_LENS_LABELS: Record<OverviewLens, string> = {
  flow: "Flow",
  structure: "Structure",
  dependencies: "Dependencies",
};

export const OVERVIEW_LENS_OPTIONS = OVERVIEW_LENSES.map((id) => ({
  id,
  label: OVERVIEW_LENS_LABELS[id],
}));

function isOverviewLens(value: string): value is OverviewLens {
  return (OVERVIEW_LENSES as readonly string[]).includes(value);
}

/** Parse `lens` query value; unknown or absent → Flow. */
export function parseOverviewLens(value: string | null): OverviewLens {
  if (value != null && isOverviewLens(value)) return value;
  return DEFAULT_OVERVIEW_LENS;
}

/**
 * Write lens into search params. Default (`flow`) omits the param so the
 * URL stays clean when absent means Flow.
 */
export function writeOverviewLensParam(
  params: URLSearchParams,
  lens: OverviewLens,
): URLSearchParams {
  const next = new URLSearchParams(params);
  if (lens === DEFAULT_OVERVIEW_LENS) {
    next.delete("lens");
  } else {
    next.set("lens", lens);
  }
  return next;
}
