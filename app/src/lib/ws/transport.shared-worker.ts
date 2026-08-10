/// <reference lib="webworker" />
/**
 * SharedWorker entry — owns the multiplexed WebSocket for the browser profile.
 */

import { createTransportWorkerOwner } from "./transport.worker-owner";

const WS_PATH = "/api/ws";

const owner = createTransportWorkerOwner({
  wsUrl: () => {
    const protocol = self.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${self.location.host}${WS_PATH}`;
  },
});

const worker = self as unknown as SharedWorkerGlobalScope;

worker.onconnect = (event: MessageEvent) => {
  const port = event.ports[0];
  if (!port) return;
  owner.attachPort(port);
};
