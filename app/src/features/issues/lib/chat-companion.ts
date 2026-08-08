/** Detail companion collapse override, persisted as `?chat=`. */
export const CHAT_COMPANION_STATES = ["expanded", "collapsed"] as const;

export type ChatCompanionState = (typeof CHAT_COMPANION_STATES)[number];

/**
 * Resolved preference: explicit URL override, or adaptive when `chat` is
 * absent / unknown.
 */
export type ChatCompanionPreference = ChatCompanionState | "adaptive";

function isChatCompanionState(value: string): value is ChatCompanionState {
  return (CHAT_COMPANION_STATES as readonly string[]).includes(value);
}

/** Parse `chat` query value; absent or unknown → adaptive. */
export function parseChatCompanionPreference(
  value: string | null,
): ChatCompanionPreference {
  if (value != null && isChatCompanionState(value)) return value;
  return "adaptive";
}

/**
 * Write an explicit companion override into search params. Absence means
 * adaptive, so both `expanded` and `collapsed` must stay in the URL.
 */
export function writeChatCompanionParam(
  params: URLSearchParams,
  state: ChatCompanionState,
): URLSearchParams {
  const next = new URLSearchParams(params);
  next.set("chat", state);
  return next;
}

/** Open when the URL forces it, or (adaptively) when there is signal. */
export function resolveChatCompanionExpanded(
  preference: ChatCompanionPreference,
  signal: { hasMessages: boolean; agentLive: boolean },
): boolean {
  if (preference === "expanded") return true;
  if (preference === "collapsed") return false;
  return signal.hasMessages || signal.agentLive;
}
