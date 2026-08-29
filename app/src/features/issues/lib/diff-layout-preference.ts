export type DiffLayout = "unified" | "split";

export const DIFF_LAYOUT_STORAGE_KEY = "issue-tracker.diff-layout";
export const DEFAULT_DIFF_LAYOUT: DiffLayout = "unified";

export function parseDiffLayout(value: string | null | undefined): DiffLayout {
  return value === "split" ? "split" : "unified";
}

export function readStoredDiffLayout(
  storage: Pick<Storage, "getItem"> = localStorage,
): DiffLayout {
  if (typeof storage.getItem !== "function") return DEFAULT_DIFF_LAYOUT;
  return parseDiffLayout(storage.getItem(DIFF_LAYOUT_STORAGE_KEY));
}

export function writeStoredDiffLayout(
  layout: DiffLayout,
  storage: Pick<Storage, "setItem"> = localStorage,
): void {
  if (typeof storage.setItem !== "function") return;
  storage.setItem(DIFF_LAYOUT_STORAGE_KEY, layout);
}

export function effectiveDiffLayout(
  layout: DiffLayout,
  isMobile: boolean,
): DiffLayout {
  return isMobile ? "unified" : layout;
}
