import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { conversationsDir } from "../config.js";
import { parseConversationMeta, type ConversationMeta } from "../schemas.js";

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
  const ids: string[] = [];
  for (const entry of readdirSync(conversationsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (existsSync(metaPathOf(entry.name))) ids.push(entry.name);
  }
  return ids;
}

/**
 * Readable conversation metadata on disk. Unreadable and mismatched
 * `meta.json` files are skipped so one bad directory cannot hide the rest.
 */
export function storedConversationMetas(): ConversationMeta[] {
  if (!existsSync(conversationsDir)) return [];
  const metas: ConversationMeta[] = [];
  for (const entry of readdirSync(conversationsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = metaPathOf(entry.name);
    if (!existsSync(path)) continue;
    try {
      const parsed = parseConversationMeta(
        JSON.parse(readFileSync(path, "utf8")),
      );
      if (!parsed.ok || parsed.meta.id !== entry.name) continue;
      metas.push(parsed.meta);
    } catch {
      // One unreadable conversation must not hide the rest.
    }
  }
  return metas;
}

/** Ids whose `meta.json` parses and names the directory. */
export function readableConversationIds(): string[] {
  return storedConversationMetas().map((meta) => meta.id);
}
