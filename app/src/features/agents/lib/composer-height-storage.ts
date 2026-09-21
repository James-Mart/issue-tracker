export const COMPOSER_HEIGHT_STORAGE_KEY = "issue-tracker.composer-height";

export function readComposerHeight(): number | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(COMPOSER_HEIGHT_STORAGE_KEY);
  if (raw === null) return null;
  const height = Number.parseFloat(raw);
  if (!Number.isFinite(height) || height <= 0) return null;
  return height;
}

export function writeComposerHeight(height: number): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(COMPOSER_HEIGHT_STORAGE_KEY, String(height));
}

export function clearComposerHeight(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(COMPOSER_HEIGHT_STORAGE_KEY);
}
