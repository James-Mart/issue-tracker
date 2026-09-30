import * as fs from "fs";
import type { ConversationTranscriptPage, TranscriptEvent } from "../schemas.js";
import {
  awaitingHumanAfterTurnBoundary,
  awaitingHumanFromTranscript,
} from "./awaiting-human.js";
import {
  parseStampedTranscriptLine,
  readAllTranscriptEvents,
  transcriptPathOf,
} from "./conversation-transcript-seq.js";

export const DEFAULT_TRANSCRIPT_PAGE_LIMIT = 100;

const CHUNK_BYTES = 4096;

type TranscriptHistoryPage = Required<
  Pick<ConversationTranscriptPage, "events" | "latestSeq" | "hasMore">
>;

/**
 * Newest `limit` events with `seq` less than `before` (the newest `limit`
 * when `before` is omitted), in ascending seq.
 *
 * Append order matches seq order, so the page is a tail slice. A `before`
 * cursor binary-searches to that slice: the read is the page plus a
 * logarithmic probe, not the whole file. Lines without a stored seq use
 * 1-based line order, which a tail read cannot assign, so those files fall
 * back to a full read.
 */
export function readTranscriptPage(
  conversationId: string,
  options: { before?: number; limit: number },
): TranscriptHistoryPage {
  const path = transcriptPathOf(conversationId);
  if (!fs.existsSync(path)) {
    return { events: [], latestSeq: 0, hasMore: false };
  }
  const fd = fs.openSync(path, "r");
  try {
    const size = fs.fstatSync(fd).size;
    if (size === 0) return { events: [], latestSeq: 0, hasMore: false };
    const tailed = readTailPage(fd, size, options);
    return tailed === "full" ? pageFromAll(conversationId, options) : tailed;
  } finally {
    fs.closeSync(fd);
  }
}

function readTailPage(
  fd: number,
  size: number,
  options: { before?: number; limit: number },
): TranscriptHistoryPage | "full" {
  const end =
    options.before === undefined
      ? size
      : exclusiveEndForBefore(fd, size, options.before);
  if (end === "full") return "full";
  const collected = collectPage(fd, end, options);
  if (collected === "full") return "full";
  const latestSeq = end === size ? collected.latestSeq : newestSeq(fd, size);
  if (latestSeq === "full") return "full";
  return {
    events: collected.events,
    latestSeq,
    hasMore: collected.hasMore,
  };
}

function pageFromAll(
  conversationId: string,
  options: { before?: number; limit: number },
): TranscriptHistoryPage {
  const events = readAllTranscriptEvents(conversationId);
  const latestSeq = events.at(-1)?.seq ?? 0;
  const before = options.before;
  const eligible =
    before === undefined ? events : events.filter((event) => event.seq < before);
  return {
    events: eligible.slice(-options.limit),
    latestSeq,
    hasMore: eligible.length > options.limit,
  };
}

function collectPage(
  fd: number,
  endExclusive: number,
  options: { before?: number; limit: number },
):
  | { events: TranscriptEvent[]; hasMore: boolean; latestSeq: number }
  | "full" {
  const matches: TranscriptEvent[] = [];
  let latestSeq = 0;
  let sawEvent = false;
  let full = false;
  let hasMore = false;
  forEachLineBackward(fd, endExclusive, (line) => {
    if (!line.trim()) return false;
    const parsed = parseStampedTranscriptLine(line);
    if (!parsed) return false;
    if (!parsed.stamped) {
      full = true;
      return true;
    }
    const seq = parsed.event.seq;
    if (!sawEvent) {
      sawEvent = true;
      latestSeq = seq;
    }
    if (options.before !== undefined && seq >= options.before) return false;
    if (matches.length < options.limit) {
      matches.push(parsed.event);
      return false;
    }
    hasMore = true;
    return true;
  });
  if (full) return "full";
  matches.reverse();
  return { events: matches, hasMore, latestSeq };
}

/** Seq of the newest valid event, or a full read when that event has no stored seq. */
function newestSeq(fd: number, size: number): number | "full" {
  let seq: number | "full" | undefined;
  forEachLineBackward(fd, size, (line) => {
    if (!line.trim()) return false;
    const parsed = parseStampedTranscriptLine(line);
    if (!parsed) return false;
    if (!parsed.stamped) {
      seq = "full";
      return true;
    }
    seq = parsed.event.seq;
    return true;
  });
  return seq ?? 0;
}

/**
 * Exclusive end offset of events with seq less than `before`: the start of the
 * first later line, or `size` when every event is still inside the page.
 */
function exclusiveEndForBefore(
  fd: number,
  size: number,
  before: number,
): number | "full" {
  let lo = 0;
  let hi = size;
  let split = size;
  while (lo < hi) {
    const prevLo = lo;
    const prevHi = hi;
    const mid = lo + Math.floor((hi - lo) / 2);
    const found = nextComparableLine(fd, size, mid);
    if (found === "full") return "full";
    if (found === null || found.start >= hi) {
      hi = mid;
    } else if (found.event.seq >= before) {
      split = found.start;
      hi = found.start;
    } else {
      lo = found.end;
    }
    if (lo === prevLo && hi === prevHi) {
      throw new Error("transcript page search did not converge");
    }
  }
  return split;
}

function nextComparableLine(
  fd: number,
  size: number,
  offset: number,
): { event: TranscriptEvent & { seq: number }; start: number; end: number } | "full" | null {
  let cursor = offset;
  while (cursor < size) {
    const start = lineStartAt(fd, size, cursor);
    const line = readLineFrom(fd, size, start);
    if (line.end <= cursor) return null;
    if (line.text.trim()) {
      const parsed = parseStampedTranscriptLine(line.text);
      if (parsed) {
        if (!parsed.stamped) return "full";
        return { event: parsed.event, start, end: line.end };
      }
    }
    cursor = line.end;
  }
  return null;
}

/** Start offset of the line that contains the byte at `offset`. */
function lineStartAt(fd: number, size: number, offset: number): number {
  if (offset <= 0) return 0;
  let pos = Math.min(offset, size);
  while (pos > 0) {
    const length = Math.min(CHUNK_BYTES, pos);
    pos -= length;
    const buf = Buffer.alloc(length);
    const n = fs.readSync(fd, buf, 0, length, pos);
    const slice = buf.subarray(0, n);
    for (let i = slice.length - 1; i >= 0; i -= 1) {
      if (slice[i] === 0x0a) return pos + i + 1;
    }
  }
  return 0;
}

function readLineFrom(
  fd: number,
  size: number,
  start: number,
): { text: string; end: number } {
  const chunks: Buffer[] = [];
  let pos = start;
  while (pos < size) {
    const length = Math.min(CHUNK_BYTES, size - pos);
    const buf = Buffer.alloc(length);
    const n = fs.readSync(fd, buf, 0, length, pos);
    if (n <= 0) break;
    const slice = buf.subarray(0, n);
    const nl = slice.indexOf(0x0a);
    if (nl !== -1) {
      chunks.push(slice.subarray(0, nl));
      return { text: Buffer.concat(chunks).toString("utf8"), end: pos + nl + 1 };
    }
    chunks.push(slice);
    pos += n;
  }
  return { text: Buffer.concat(chunks).toString("utf8"), end: size };
}

/**
 * Derive awaitingHuman from the transcript on disk. Uses a backward tail scan
 * and falls back to a full read only when an unstamped legacy line appears.
 */
export function awaitingHumanFromTranscriptFile(
  conversationId: string,
): boolean {
  const tail = scanAwaitingHumanTailEvents(conversationId);
  if (tail === "full") {
    return awaitingHumanFromTranscript(
      readAllTranscriptEvents(conversationId),
    );
  }
  return awaitingHumanFromTranscript(tail);
}

function scanAwaitingHumanTailEvents(
  conversationId: string,
): readonly TranscriptEvent[] | "full" {
  const path = transcriptPathOf(conversationId);
  if (!fs.existsSync(path)) return [];
  const fd = fs.openSync(path, "r");
  try {
    const size = fs.fstatSync(fd).size;
    if (size === 0) return [];
    const tailEvents: TranscriptEvent[] = [];
    let full = false;
    forEachLineBackward(fd, size, (line) => {
      if (!line.trim()) return false;
      const parsed = parseStampedTranscriptLine(line);
      if (!parsed) return false;
      if (!parsed.stamped) {
        full = true;
        return true;
      }
      tailEvents.push(parsed.event);
      return awaitingHumanAfterTurnBoundary(parsed.event.type) !== undefined;
    });
    if (full) return "full";
    tailEvents.reverse();
    return tailEvents;
  } finally {
    fs.closeSync(fd);
  }
}

/** Newest line first. `onLine` returns true to stop. */
function forEachLineBackward(
  fd: number,
  endExclusive: number,
  onLine: (line: string) => boolean,
): void {
  let position = endExclusive;
  let pending = Buffer.alloc(0);
  while (position > 0) {
    const length = Math.min(CHUNK_BYTES, position);
    position -= length;
    const buf = Buffer.alloc(length);
    const n = fs.readSync(fd, buf, 0, length, position);
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
