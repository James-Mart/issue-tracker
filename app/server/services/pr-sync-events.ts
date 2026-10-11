import { publishFrame } from "./conversation-stream.js";
import { PR_SYNC_TOPIC, type PrSyncEvent } from "./pr-sync-topic.js";

export { PR_SYNC_TOPIC };

export function publishPrSyncFinished(projectId: string): void {
  const event: PrSyncEvent = { type: "pr-sync", projectId };
  publishFrame(PR_SYNC_TOPIC, { event, persist: false });
}
