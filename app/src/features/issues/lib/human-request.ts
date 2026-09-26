import type { CommentMessage, ReviewStatus } from "@server/schemas";

export type HumanRequestItem =
  | { kind: "secret"; key: string; detail: string }
  | { kind: "input"; detail: string }
  | { kind: "observation"; detail: string };

const BULLET = /^[-*+] (.*)$/;
const SECRET_ITEM = /^Secret `([^`]*)`:(.*)$/;
const LABELED_ITEM = /^(Input|Observation):(.*)$/;

/** Items of a human-request body. Lines that are not request items are skipped. */
export function parseHumanRequestItems(body: string): HumanRequestItem[] {
  const items: HumanRequestItem[] = [];
  for (const line of body.replace(/\r\n/g, "\n").split("\n")) {
    const text = BULLET.exec(line)?.[1];
    if (!text) continue;
    const secret = SECRET_ITEM.exec(text);
    if (secret?.[1]) {
      items.push({
        kind: "secret",
        key: secret[1],
        detail: (secret[2] ?? "").trim(),
      });
      continue;
    }
    const labeled = LABELED_ITEM.exec(text);
    const label = labeled?.[1];
    if (!labeled || !label) continue;
    items.push({
      kind: label === "Input" ? "input" : "observation",
      detail: (labeled[2] ?? "").trim(),
    });
  }
  return items;
}

export type HumanHandoffView =
  | { mode: "awaiting"; request: CommentMessage; items: HumanRequestItem[] }
  | {
      mode: "completed";
      request: CommentMessage;
      response: CommentMessage;
      items: HumanRequestItem[];
    };

function isRequest(message: CommentMessage): boolean {
  return message.type === "human-request" && message.replyTo === undefined;
}

function responseFor(
  messages: CommentMessage[],
  requestId: string,
): CommentMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.type === "human-response" && message.replyTo === requestId) {
      return message;
    }
  }
  return undefined;
}

/**
 * The open request while `review` is `awaiting-human`, otherwise the latest
 * request that already has a human response.
 */
export function humanHandoffView(
  review: ReviewStatus | undefined,
  messages: CommentMessage[],
): HumanHandoffView | null {
  const requests = messages.filter(isRequest);
  if (review === "awaiting-human") {
    const open = [...requests]
      .reverse()
      .find((request) => !responseFor(messages, request.id));
    if (!open) return null;
    return {
      mode: "awaiting",
      request: open,
      items: parseHumanRequestItems(open.body),
    };
  }

  const latest = requests[requests.length - 1];
  if (!latest) return null;
  const response = responseFor(messages, latest.id);
  if (!response) return null;
  return {
    mode: "completed",
    request: latest,
    response,
    items: parseHumanRequestItems(latest.body),
  };
}
