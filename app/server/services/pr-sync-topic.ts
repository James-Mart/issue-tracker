/** Multiplex topic. A frame means one Project's sync pass finished. */
export const PR_SYNC_TOPIC = "pr-sync";

export type PrSyncEvent = {
  type: "pr-sync";
  projectId: string;
};
