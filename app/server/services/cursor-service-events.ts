import { publishFrame } from "./conversation-stream.js";
import {
  CURSOR_SERVICE_TOPIC,
  type CursorServiceEvent,
} from "./cursor-service-topic.js";

export { CURSOR_SERVICE_TOPIC };

/** An outage fails every in-flight call; one notice per window is enough. */
export const CURSOR_UNAVAILABLE_NOTICE_INTERVAL_MS = 60_000;

let lastPublishedAt: number | undefined;

export function publishCursorUnavailable(now: number = Date.now()): void {
  if (
    lastPublishedAt !== undefined &&
    now - lastPublishedAt < CURSOR_UNAVAILABLE_NOTICE_INTERVAL_MS
  ) {
    return;
  }
  lastPublishedAt = now;
  const event: CursorServiceEvent = { type: "cursor-unavailable" };
  publishFrame(CURSOR_SERVICE_TOPIC, { event, persist: false });
}

export function resetCursorUnavailableNoticeForTests(): void {
  lastPublishedAt = undefined;
}
