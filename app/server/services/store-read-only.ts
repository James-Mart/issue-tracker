import { storeReadOnly, trackerGuest } from "../config.js";
import { IssueError } from "./errors.js";

/**
 * Two-phase read-only.
 * Refusal: read-only without guest refuses store writes. Both flags: guest
 * wins and those writes proceed.
 * Guest-duty: either flag skips the boot-time agent-stack record sweep and
 * the store backup snapshot driver.
 */
export function refusesStoreWrites(): boolean {
  return storeReadOnly && !trackerGuest;
}

export function skipsGuestDuties(): boolean {
  return storeReadOnly || trackerGuest;
}

/** Refuse tracker-store writes under the refusal phase above. */
export function assertStoreWritable(): void {
  if (refusesStoreWrites()) {
    throw new IssueError("read_only", "tracker store is read-only");
  }
}
