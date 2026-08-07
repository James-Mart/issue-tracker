import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { evictAppendingRunEventsStore } from "./appending-run-events-store.js";
import { evictCachedCheckpointsStore } from "./cached-checkpoints-store.js";

/**
 * Both store wrappers hold a per-`storeDir` in-memory index, and a conversation
 * owns several such directories: its own `agent-state` plus one per nested
 * delegation. Evicting them together keeps the two indexes from outliving the
 * agent session that justified them, and from serving state written by anything
 * that touched the files while no session held them.
 */

function evictStoreDir(storeDir: string): void {
  evictCachedCheckpointsStore(storeDir);
  evictAppendingRunEventsStore(storeDir);
}

/**
 * Evict a conversation's `agent-state` storeDir and every immediate child
 * directory under `agent-state/nested/`. Safe when a path was never cached;
 * walks the nested listing even when individual children have no entry.
 */
export function evictConversationStoreCaches(storeDir: string): void {
  evictStoreDir(storeDir);
  const nestedRoot = join(storeDir, "nested");
  if (!existsSync(nestedRoot)) return;
  for (const ent of readdirSync(nestedRoot, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      evictStoreDir(join(nestedRoot, ent.name));
    }
  }
}
