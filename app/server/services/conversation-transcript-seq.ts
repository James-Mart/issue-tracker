import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { conversationsDir } from "../config.js";
import {
  parseTranscriptEvent,
  type TranscriptEvent,
} from "../schemas/conversation.js";

export { parseTranscriptEvent };

export function transcriptPathOf(conversationId: string): string {
  return join(conversationsDir, conversationId, "transcript.jsonl");
}

/** Effective seq for one transcript line: stored value or 1-based line order. */
export function effectiveTranscriptSeq(raw: unknown, lineSeq: number): number {
  if (
    typeof raw === "object" &&
    raw !== null &&
    typeof (raw as { seq?: unknown }).seq === "number" &&
    (raw as { seq: number }).seq >= 0
  ) {
    return (raw as { seq: number }).seq;
  }
  return lineSeq;
}

export type SequencedTranscriptEvent = TranscriptEvent & { seq: number };

/**
 * One transcript line, without assigning line-order seq.
 * Invalid JSON and lines that are not transcript events are skipped: a file
 * can hold a torn write or a legacy line, and one bad line must not hide the
 * rest of the history. `stamped` is false when the line has no stored seq.
 */
export function parseStampedTranscriptLine(line: string):
  | { stamped: true; event: SequencedTranscriptEvent }
  | { stamped: false; event: TranscriptEvent }
  | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return undefined;
  }
  const parsed = parseTranscriptEvent(raw);
  if (!parsed.ok) return undefined;
  if (parsed.event.seq !== undefined) {
    return {
      stamped: true,
      event: { ...parsed.event, seq: parsed.event.seq },
    };
  }
  return { stamped: false, event: parsed.event };
}

/** One non-empty transcript line. Unstamped lines take 1-based line order as seq. */
export function parseTranscriptLine(
  line: string,
  lineSeq: number,
): { event: SequencedTranscriptEvent; stamped: boolean } | undefined {
  const parsed = parseStampedTranscriptLine(line);
  if (!parsed) return undefined;
  if (parsed.stamped) return parsed;
  return { event: { ...parsed.event, seq: lineSeq }, stamped: false };
}

/** Every valid transcript event in file order. Missing file is an empty transcript. */
export function readAllTranscriptEvents(
  conversationId: string,
): SequencedTranscriptEvent[] {
  const path = transcriptPathOf(conversationId);
  if (!existsSync(path)) return [];
  const events: SequencedTranscriptEvent[] = [];
  let lineSeq = 0;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    lineSeq += 1;
    const parsed = parseTranscriptLine(line, lineSeq);
    if (parsed) events.push(parsed.event);
  }
  return events;
}

/** Highest seq in a conversation transcript, including legacy line-order fallback. */
export function maxSeqFromTranscriptFile(conversationId: string): number {
  const path = transcriptPathOf(conversationId);
  if (!existsSync(path)) return 0;
  let max = 0;
  let lineSeq = 0;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    lineSeq += 1;
    try {
      max = Math.max(max, effectiveTranscriptSeq(JSON.parse(line), lineSeq));
    } catch {
      // skip malformed lines
    }
  }
  return max;
}
