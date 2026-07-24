/** Detail companion collapse state, persisted as `?chat=`. */
export const CHAT_COMPANION_STATES = ["expanded", "collapsed"] as const;

export type ChatCompanionState = (typeof CHAT_COMPANION_STATES)[number];

/** Default when `chat` is absent — companion is shown. */
export const DEFAULT_CHAT_COMPANION_STATE: ChatCompanionState = "expanded";

function isChatCompanionState(value: string): value is ChatCompanionState {
  return (CHAT_COMPANION_STATES as readonly string[]).includes(value);
}

/** Parse `chat` query value; absent or unknown → expanded. */
export function parseChatCompanionState(
  value: string | null,
): ChatCompanionState {
  if (value != null && isChatCompanionState(value)) return value;
  return DEFAULT_CHAT_COMPANION_STATE;
}

/**
 * Write companion state into search params. Default (`expanded`) omits the
 * param so the URL stays clean when absent means shown.
 */
export function writeChatCompanionParam(
  params: URLSearchParams,
  state: ChatCompanionState,
): URLSearchParams {
  const next = new URLSearchParams(params);
  if (state === DEFAULT_CHAT_COMPANION_STATE) {
    next.delete("chat");
  } else {
    next.set("chat", state);
  }
  return next;
}
