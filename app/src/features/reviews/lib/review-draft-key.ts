/** `review:<reviewId>:<location>` — the draft key a review composer stores. */
export function reviewDraftKey(reviewId: string, location: string): string {
  return `review:${reviewId}:${location}`;
}

export function conversationDraftKey(reviewId: string): string {
  return reviewDraftKey(reviewId, "conversation");
}

export function replyDraftKey(reviewId: string, threadId: string): string {
  return reviewDraftKey(reviewId, `reply:${threadId}`);
}
