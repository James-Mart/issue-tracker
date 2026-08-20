import { randomUUID } from "node:crypto";

/** Stable for this process — changes after a supervised restart. */
export const bootId = randomUUID();

/** When this process started (ms since epoch). */
export const processStartedAt = Date.now();
