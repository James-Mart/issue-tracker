import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { conversationsDir } from "../config.js";
import { parseConversationMeta } from "../schemas.js";

function dirOf(id: string): string {
  return join(conversationsDir, id);
}

function metaPathOf(id: string): string {
  return join(dirOf(id), "meta.json");
}

/** True when `meta.json` exists for the conversation id. */
export function conversationExists(id: string): boolean {
  return existsSync(metaPathOf(id));
}

/**
 * Conversation store ids on disk. Side-state dirs (agent-stack, mockups,
 * cursor index) share the store without a `meta.json` and are not conversations.
 */
export function listConversationIds(): string[] {
  if (!existsSync(conversationsDir)) return [];
  return readdirSync(conversationsDir).filter(
    (entry) => statSync(dirOf(entry)).isDirectory() && existsSync(metaPathOf(entry)),
  );
}

/** Ids whose `meta.json` parses and names the directory. */
export function readableConversationIds(): string[] {
  const ids: string[] = [];
  for (const id of listConversationIds()) {
    try {
      const parsed = parseConversationMeta(
        JSON.parse(readFileSync(metaPathOf(id), "utf8")),
      );
      if (parsed.ok && parsed.meta.id === id) ids.push(id);
    } catch {
      // One unreadable conversation must not hide every other delegation.
    }
  }
  return ids;
}
