import { useCallback, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readReviewDraft(draftKey: string): string {
  return localStorage.getItem(draftKey) ?? "";
}

function writeReviewDraft(draftKey: string, draft: string): void {
  if (draft === "") {
    localStorage.removeItem(draftKey);
  } else {
    localStorage.setItem(draftKey, draft);
  }
  for (const listener of listeners) listener();
}

/** Drop a stored draft and tell open composers. */
export function clearReviewDraft(draftKey: string): void {
  writeReviewDraft(draftKey, "");
}

/** Store `draft` only when this key has no draft yet. */
export function seedReviewDraftIfAbsent(draftKey: string, draft: string): void {
  if (localStorage.getItem(draftKey) !== null) return;
  writeReviewDraft(draftKey, draft);
}

/** A review draft in this browser, stored under its `review:<reviewId>:<location>` key. */
export function useReviewDraft(
  draftKey: string,
): [string, (draft: string) => void] {
  const draft = useSyncExternalStore(subscribe, () => readReviewDraft(draftKey));
  const setDraft = useCallback(
    (next: string) => writeReviewDraft(draftKey, next),
    [draftKey],
  );
  return [draft, setDraft];
}
