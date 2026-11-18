import type { AgentStreamEvent } from "./agent-sdk.js";

type AssistantStreamMessage = Extract<
  Extract<AgentStreamEvent, { kind: "message" }>["message"],
  { type: "assistant" }
>;

type UserStreamMessage = Extract<
  Extract<AgentStreamEvent, { kind: "message" }>["message"],
  { type: "user" }
>;

/** Text blocks of a stream message, in order. */
export function messageContentText(
  content: ReadonlyArray<{ type: string; text?: string }>,
): string {
  let text = "";
  for (const block of content) {
    if (block.type === "text" && block.text) text += block.text;
  }
  return text;
}

/** Text of one assistant stream message, in block order. */
export function assistantMessageText(message: AssistantStreamMessage): string {
  return messageContentText(message.message.content);
}

/** Text of one user stream message, in block order. */
export function userMessageText(message: UserStreamMessage): string {
  return messageContentText(message.message.content);
}
