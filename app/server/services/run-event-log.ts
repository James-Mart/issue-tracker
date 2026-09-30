import { createHash } from "crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { conversationsDir } from "../config.js";
import type { TranscriptEvent } from "../schemas.js";
import {
  parseTranscriptLine,
  readAllTranscriptEvents,
} from "./conversation-transcript-seq.js";

type SubagentUpdateEvent = Extract<TranscriptEvent, { type: "subagent_update" }>;

const READY_NAME = "ready";

function runEventsDir(conversationId: string): string {
  return join(conversationsDir, conversationId, "run-events");
}

function readyPath(conversationId: string): string {
  return join(runEventsDir(conversationId), READY_NAME);
}

/** Filename for one parent call. Slashes and `.` / `..` stay inside `run-events`. */
function runEventFileName(parentCallId: string): string {
  const encoded = encodeURIComponent(parentCallId);
  const base =
    encoded === "." || encoded === ".." || encoded.length > 200
      ? createHash("sha256").update(parentCallId).digest("hex")
      : encoded;
  return `${base}.jsonl`;
}

function eventPath(conversationId: string, parentCallId: string): string {
  return join(runEventsDir(conversationId), runEventFileName(parentCallId));
}

function isReady(conversationId: string): boolean {
  return existsSync(readyPath(conversationId));
}

/**
 * One file per `parentCallId` beside the transcript. A missing log is built
 * once from that conversation's transcript; later `subagent_update` writes append.
 */
function materialize(conversationId: string): void {
  if (isReady(conversationId)) return;
  const groups = new Map<string, SubagentUpdateEvent[]>();
  for (const event of readAllTranscriptEvents(conversationId)) {
    if (event.type !== "subagent_update") continue;
    const group = groups.get(event.parentCallId);
    if (group) group.push(event);
    else groups.set(event.parentCallId, [event]);
  }
  const dir = runEventsDir(conversationId);
  mkdirSync(dir, { recursive: true });
  for (const [parentCallId, group] of groups) {
    group.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    writeFileSync(
      eventPath(conversationId, parentCallId),
      `${group.map((event) => JSON.stringify(event)).join("\n")}\n`,
    );
  }
  writeFileSync(readyPath(conversationId), "");
}

/** Append one `subagent_update` that was just written to the transcript. */
export function recordSubagentUpdate(
  conversationId: string,
  event: SubagentUpdateEvent,
): void {
  if (!isReady(conversationId)) {
    materialize(conversationId);
    return;
  }
  const path = eventPath(conversationId, event.parentCallId);
  mkdirSync(runEventsDir(conversationId), { recursive: true });
  appendFileSync(path, `${JSON.stringify(event)}\n`);
}

/** Events for one parent call. The log is stored in `seq` order. */
export function readRunEvents(
  conversationId: string,
  parentCallId: string,
): SubagentUpdateEvent[] {
  materialize(conversationId);
  const path = eventPath(conversationId, parentCallId);
  if (!existsSync(path)) return [];
  const events: SubagentUpdateEvent[] = [];
  let lineSeq = 0;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    lineSeq += 1;
    const parsed = parseTranscriptLine(line, lineSeq);
    if (!parsed || parsed.event.type !== "subagent_update") continue;
    events.push(parsed.event);
  }
  return events;
}
