export const EXPANDED_KEY = "issue-tracker.expanded";
export const EXPANDED_VERSION_KEY = "issue-tracker.expanded.v";
export const EXPANDED_VERSION = "2";

export function loadExpanded(
  storage: Pick<Storage, "getItem"> = localStorage,
): Record<string, boolean> {
  const raw = storage.getItem(EXPANDED_KEY);
  if (!raw) return {};
  const v2 = expandedMigrationDone(storage);
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const expanded: Record<string, boolean> = {};
      for (const [id, value] of Object.entries(parsed)) {
        if (value === false) expanded[id] = false;
        else if (v2 && value === true) expanded[id] = true;
      }
      return expanded;
    }
  } catch {
    // ignore invalid stored value
  }
  return {};
}

export function saveExpanded(
  expanded: Record<string, boolean>,
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> = localStorage,
): void {
  if (Object.keys(expanded).length === 0) {
    storage.removeItem(EXPANDED_KEY);
  } else {
    storage.setItem(EXPANDED_KEY, JSON.stringify(expanded));
  }
}

export function resolveExpanded(
  expanded: Record<string, boolean>,
  id: string,
  fallbackExpanded: boolean,
): boolean {
  return expanded[id] ?? fallbackExpanded;
}

export function toggleExpanded(
  expanded: Record<string, boolean>,
  id: string,
  fallbackExpanded: boolean,
): Record<string, boolean> {
  const next = !resolveExpanded(expanded, id, fallbackExpanded);
  return { ...expanded, [id]: next };
}

export function expandedMigrationDone(
  storage: Pick<Storage, "getItem"> = localStorage,
): boolean {
  return storage.getItem(EXPANDED_VERSION_KEY) === EXPANDED_VERSION;
}

/**
 * One-shot: existing board roots with no stored entry become expanded so the
 * tree does not jump when v2 ships. No-op once {@link EXPANDED_VERSION_KEY} is
 * `2`.
 */
export function ensureBoardRootsExpandedOnce(
  expanded: Record<string, boolean>,
  boardRootIds: readonly string[],
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> = localStorage,
): Record<string, boolean> {
  if (expandedMigrationDone(storage)) return expanded;

  const next = { ...expanded };
  for (const id of boardRootIds) {
    if (!(id in next)) next[id] = true;
  }
  saveExpanded(next, storage);
  storage.setItem(EXPANDED_VERSION_KEY, EXPANDED_VERSION);
  return next;
}
