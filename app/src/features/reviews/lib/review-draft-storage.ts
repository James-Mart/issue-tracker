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
