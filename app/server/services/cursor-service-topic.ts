/** Multiplex topic. A frame means a Cursor backend call just came back unavailable. */
export const CURSOR_SERVICE_TOPIC = "cursor-service";

export type CursorServiceEvent = {
  type: "cursor-unavailable";
};
