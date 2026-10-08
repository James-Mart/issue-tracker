import { publishFrame } from "./conversation-stream.js";
import { PR_SYNC_TOPIC } from "./pr-sync-topic.js";

export { PR_SYNC_TOPIC };

export type PrSyncEvent = {
  type: "pr-sync";
  projectId: string;
};

export function publishPrSyncFinished(projectId: string): void {
  const event: PrSyncEvent = { type: "pr-sync", projectId };
  publishFrame(PR_SYNC_TOPIC, { event, persist: false });
}
