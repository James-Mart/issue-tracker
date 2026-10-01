import type { CommentInput, CommentMessage } from "@server/schemas";

/**
 * A comment posted from this browser that the comments list does not carry
 * yet. `sent` waits for the list to catch up to the confirmed post.
 */
export type CommentDelivery =
  | { status: "sending" }
  | { status: "sent" }
  | { status: "failed"; error: string };

export type OutboxComment = {
  issueId: string;
  clientId: string;
  input: CommentInput & { clientId: string };
  at: string;
  delivery: CommentDelivery;
};

/** A stored comment, or this browser's copy of one the list does not carry yet. */
export type ThreadMessage =
  | (CommentMessage & { delivery?: undefined })
  | (CommentMessage & { clientId: string; delivery: CommentDelivery });

export function storedClientIds(messages: CommentMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    if (message.clientId) ids.add(message.clientId);
  }
  return ids;
}

/** Outbox copies whose stored record is not in `messages` yet, after `messages`. */
export function withOutboxComments(
  messages: CommentMessage[],
  outbox: OutboxComment[],
): ThreadMessage[] {
  if (outbox.length === 0) return messages;
  const stored = storedClientIds(messages);
  const pending = outbox
    .filter((entry) => !stored.has(entry.clientId))
    .map(
      (entry): ThreadMessage => ({
        ...entry.input,
        id: entry.clientId,
        at: entry.at,
        delivery: entry.delivery,
      }),
    );
  return pending.length > 0 ? [...messages, ...pending] : messages;
}
