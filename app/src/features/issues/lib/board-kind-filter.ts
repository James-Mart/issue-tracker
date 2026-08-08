/** Board-root kinds selectable in the overview Type filter. */
export const BOARD_KIND_OPTIONS = ["epic", "idea", "story"] as const;

export type BoardKindOption = (typeof BOARD_KIND_OPTIONS)[number];

/**
 * Selected board kinds for an OR-filter.
 * Empty = no kind filter (all project-board roots).
 */
export type BoardKindFilter = BoardKindOption[];

export function isBoardKindOption(kind: string): kind is BoardKindOption {
  return (BOARD_KIND_OPTIONS as readonly string[]).includes(kind);
}

/** Empty selection matches every kind; otherwise OR across selected kinds. */
export function boardKindAllows(
  kind: string,
  filter: BoardKindFilter,
): boolean {
  if (filter.length === 0) return true;
  return isBoardKindOption(kind) && filter.includes(kind);
}

export function toggleBoardKind(
  current: BoardKindFilter,
  kind: BoardKindOption,
): BoardKindFilter {
  if (current.includes(kind)) return current.filter((value) => value !== kind);
  return [...current, kind];
}
