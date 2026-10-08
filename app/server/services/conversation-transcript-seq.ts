import {
  closeSync,
  existsSync,
  fstatSync,
  openSync,
  readFileSync,
  readSync,
} from "fs";
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

const TAIL_CHUNK_BYTES = 4096;

/**
 * Open a transcript, or return `empty` when the file is missing or zero
 * length. The descriptor is closed before this returns, including when
 * `read` throws.
 */
export function withOpenTranscript<T>(
  conversationId: string,
  empty: T,
  read: (fd: number, size: number) => T,
): T {
  const path = transcriptPathOf(conversationId);
  if (!existsSync(path)) return empty;
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    if (size === 0) return empty;
    return read(fd, size);
  } finally {
    closeSync(fd);
  }
}

/** Newest line first. `onLine` returns true to stop. */
export function forEachLineBackward(
  fd: number,
  endExclusive: number,
  onLine: (line: string) => boolean,
): void {
  let position = endExclusive;
  let pending = Buffer.alloc(0);
  while (position > 0) {
    const length = Math.min(TAIL_CHUNK_BYTES, position);
    position -= length;
    const buf = Buffer.alloc(length);
    const n = readSync(fd, buf, 0, length, position);
    const combined = Buffer.concat([buf.subarray(0, n), pending]);
    let cursor = combined.length;
    for (let i = combined.length - 1; i >= 0; i -= 1) {
      if (combined[i] !== 0x0a) continue;
      const line = combined.subarray(i + 1, cursor);
      cursor = i;
      if (onLine(line.toString("utf8"))) return;
    }
    if (position === 0) {
      const line = combined.subarray(0, cursor);
      if (line.length > 0) onLine(line.toString("utf8"));
      return;
    }
    pending = Buffer.from(combined.subarray(0, cursor));
  }
}

/**
 * Stored seq of the last transcript event. `"unstamped"` when that line has
 * no seq. Skips a torn or non-event tail. `undefined` when the file has no
 * transcript event.
 */
export function lastEventStoredSeq(
  fd: number,
  endExclusive: number,
): number | "unstamped" | undefined {
  let found: number | "unstamped" | undefined;
  forEachLineBackward(fd, endExclusive, (line) => {
    if (!line.trim()) return false;
    const parsed = parseStampedTranscriptLine(line);
    if (!parsed) return false;
    found = parsed.stamped ? parsed.event.seq : "unstamped";
    return true;
  });
  return found;
}

/**
 * Highest seq in a transcript. The last event's stored seq is that maximum
 * for a stamped file, including a fork prefix. A last event with no stored
 * seq is a legacy transcript: scan the file.
 */
export function maxSeqFromTranscriptTail(conversationId: string): number {
  const seq = withOpenTranscript<number | "unstamped">(
    conversationId,
    0,
    (fd, size) => {
      const stored = lastEventStoredSeq(fd, size);
      if (stored === "unstamped") return "unstamped";
      return stored ?? 0;
    },
  );
  if (seq === "unstamped") return maxSeqFromTranscriptFile(conversationId);
  return seq;
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
