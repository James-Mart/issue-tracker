export const COMPOSER_DRAFT_KEY_PREFIX = "issue-tracker.composer-draft.";

export function composerDraftStorageKey(conversationId: string): string {
  return `${COMPOSER_DRAFT_KEY_PREFIX}${conversationId}`;
}

export function readComposerDraft(conversationId: string): string {
  if (typeof localStorage === "undefined") return "";
  return localStorage.getItem(composerDraftStorageKey(conversationId)) ?? "";
}

export function writeComposerDraft(conversationId: string, draft: string): void {
  if (typeof localStorage === "undefined") return;
  const key = composerDraftStorageKey(conversationId);
  if (draft === "") {
    localStorage.removeItem(key);
  } else {
    localStorage.setItem(key, draft);
  }
}

export function clearComposerDraft(conversationId: string): void {
  writeComposerDraft(conversationId, "");
}
