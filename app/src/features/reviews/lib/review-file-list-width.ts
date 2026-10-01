/** One width for this browser, shared by every review. */
export const REVIEW_FILE_LIST_WIDTH_STORAGE_KEY =
  "issue-tracker.review-file-list-width";

/** Matches the previous fixed `shell:w-64` column. */
export const DEFAULT_REVIEW_FILE_LIST_WIDTH = 256;

export const MIN_REVIEW_FILE_LIST_WIDTH = 180;

/** Arrow-key step when the desktop grip is focused. */
export const REVIEW_FILE_LIST_WIDTH_STEP = 16;

export function maxReviewFileListWidth(splitWidth: number): number {
  return Math.floor(splitWidth / 2);
}

/** Clamp ceiling: half the split, and never below the floor. */
export function reviewFileListWidthCeiling(splitWidth: number): number {
  return Math.max(maxReviewFileListWidth(splitWidth), MIN_REVIEW_FILE_LIST_WIDTH);
}

/**
 * Never below the floor, never above half the split. A ceiling below the
 * floor (tiny split) still yields the floor — the range is empty, not inverted.
 */
export function clampReviewFileListWidth(
  width: number,
  splitWidth: number,
): number {
  return Math.round(
    Math.min(
      Math.max(width, MIN_REVIEW_FILE_LIST_WIDTH),
      reviewFileListWidthCeiling(splitWidth),
    ),
  );
}

export function readStoredReviewFileListWidth(): number | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(REVIEW_FILE_LIST_WIDTH_STORAGE_KEY);
  if (raw === null) return null;
  const width = Number.parseFloat(raw);
  // A corrupt stored width is treated as unset so the default applies.
  if (!Number.isFinite(width) || width <= 0) return null;
  return width;
}

export function writeStoredReviewFileListWidth(width: number): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(REVIEW_FILE_LIST_WIDTH_STORAGE_KEY, String(width));
}

export function clearStoredReviewFileListWidth(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(REVIEW_FILE_LIST_WIDTH_STORAGE_KEY);
}

/** Stored choice, or the default, clamped once the split has a width. */
export function resolveReviewFileListWidth(
  stored: number | null,
  splitWidth: number,
): number {
  const preferred = stored ?? DEFAULT_REVIEW_FILE_LIST_WIDTH;
  if (!(splitWidth > 0)) {
    return Math.max(Math.round(preferred), MIN_REVIEW_FILE_LIST_WIDTH);
  }
  return clampReviewFileListWidth(preferred, splitWidth);
}
