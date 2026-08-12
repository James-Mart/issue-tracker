export const DESCRIPTION_DRAFT_KEY_PREFIX = "issue-tracker.description-draft.";

export function descriptionDraftStorageKey(issueId: string): string {
  return `${DESCRIPTION_DRAFT_KEY_PREFIX}${issueId}`;
}

export function readDescriptionDraft(issueId: string): string {
  if (typeof localStorage === "undefined") return "";
  return localStorage.getItem(descriptionDraftStorageKey(issueId)) ?? "";
}

export function writeDescriptionDraft(
  issueId: string,
  draft: string,
  savedDescription: string,
): void {
  if (typeof localStorage === "undefined") return;
  const key = descriptionDraftStorageKey(issueId);
  if (draft === "" || draft === savedDescription) {
    localStorage.removeItem(key);
  } else {
    localStorage.setItem(key, draft);
  }
}

export function clearDescriptionDraft(issueId: string): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(descriptionDraftStorageKey(issueId));
}
