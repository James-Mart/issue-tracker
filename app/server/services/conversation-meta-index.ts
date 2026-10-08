import { writeFileSync } from "fs";
import { join } from "path";
import { conversationsDir } from "../config.js";
import type { ConversationMeta } from "../schemas.js";
import { storedConversationMetas } from "./conversation-ids.js";

/**
 * Conversation metadata for this process. The first use loads every readable
 * `meta.json`; later reads come from the map. Meta writes go through
 * `persistConversationMeta`, which updates the file and the map together.
 */
let indexed: Map<string, ConversationMeta> | undefined;

function index(): Map<string, ConversationMeta> {
  if (!indexed) {
    indexed = new Map(
      storedConversationMetas().map((meta) => [meta.id, meta]),
    );
  }
  return indexed;
}

export function listIndexedConversationMetas(): ConversationMeta[] {
  return [...index().values()];
}

/** Write `meta.json` and keep the in-memory index on the same object. */
export function persistConversationMeta(meta: ConversationMeta): void {
  writeFileSync(
    join(conversationsDir, meta.id, "meta.json"),
    `${JSON.stringify(meta, null, 2)}\n`,
  );
  index().set(meta.id, meta);
}

/** Drop one conversation after the service has deleted its directory. */
export function forgetConversationMeta(id: string): void {
  indexed?.delete(id);
}
