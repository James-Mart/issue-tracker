import { trackerGuest } from "../config.js";
import { throwGuestRefusal } from "./guest-refusal.js";

export const GUEST_REFUSED_WORKTREE_CREATE =
  "guest refused to create a Story worktree";
export const GUEST_REFUSED_WORKTREE_ATTACH =
  "guest refused to attach a Story worktree";
export const GUEST_REFUSED_WORKTREE_SETUP =
  "guest refused to run Story worktree setup";
export const GUEST_REFUSED_WORKTREE_REMOVE =
  "guest refused to remove a Story worktree";
export const GUEST_REFUSED_UPDATE_FROM_MERGE_BASE =
  "guest refused to update from merge base";
export const GUEST_REFUSED_MERGE = "guest refused to merge a pull request";
export const GUEST_REFUSED_BACKUP_CONFIG =
  "guest refused to write backup config";
export const GUEST_REFUSED_SECRET_WRITE =
  "guest refused to write a Project secret";
export const GUEST_REFUSED_SECRET_DELETE =
  "guest refused to delete a Project secret";
export const GUEST_REFUSED_RESTART = "guest refused to restart the tracker";

/**
 * Guest off continues. Guest on refuses git writes, `gh` writes, writes
 * outside the guest data dir, and tracker restarts.
 */
export function guestRefusesOutwardEffect(): boolean {
  return trackerGuest;
}

/** Throw a guest refusal before the outward effect. */
export function assertGuestAllowsOutwardEffect(what: string): void {
  if (guestRefusesOutwardEffect()) throwGuestRefusal(what);
}
