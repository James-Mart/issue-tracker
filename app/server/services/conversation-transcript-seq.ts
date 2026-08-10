import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { conversationsDir } from "../config.js";

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
