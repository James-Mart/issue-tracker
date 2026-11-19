import type {
  ConversationStreamEvent,
  TranscriptEvent,
} from "../schemas.js";

type AttributableBeat = {
  kind: "spawn" | "return" | "human-turn";
  parentCallId?: string;
  tokenTotal?: number;
};

type AttributableRow = {
  beat: AttributableBeat;
  seq?: number;
  at: string;
};

function compareOrder(
  a: { seq?: number; at: string },
  b: { seq?: number; at: string },
): number {
  if (a.seq !== undefined && b.seq !== undefined && a.seq !== b.seq) {
    return a.seq - b.seq;
  }
  return a.at.localeCompare(b.at);
}

export function settledRunIds(
  transcript: readonly (TranscriptEvent | ConversationStreamEvent)[],
): Set<string> {
  const settled = new Set<string>();
  for (const event of transcript) {
    if (event.type === "run_usage") settled.add(event.runId);
  }
  return settled;
}

function enclosingHumanTurn(
  rows: AttributableRow[],
  event: { seq?: number; at: string },
): AttributableRow | undefined {
  let best: AttributableRow | undefined;
  for (const row of rows) {
    if (row.beat.kind !== "human-turn") continue;
    if (compareOrder(row, event) > 0) continue;
    if (!best || compareOrder(row, best) > 0) best = row;
  }
  return best;
}

function targetRow(
  rows: AttributableRow[],
  event: { seq?: number; at: string; parentCallId?: string },
): AttributableRow | undefined {
  if (event.parentCallId !== undefined) {
    return rows.find(
      (row) =>
        row.beat.kind === "spawn" &&
        row.beat.parentCallId === event.parentCallId,
    );
  }
  return enclosingHumanTurn(rows, event);
}

/**
 * Tokens a run used. The SDK's `totalTokens` adds cache reads and writes on
 * top of `inputTokens`, which already includes them.
 */
export function usageTokenTotal(usage: {
  inputTokens: number;
  outputTokens: number;
}): number {
  return usage.inputTokens + usage.outputTokens;
}

function addTokenTotal(row: AttributableRow, tokens: number): void {
  row.beat.tokenTotal = (row.beat.tokenTotal ?? 0) + tokens;
}

/**
 * Attribute usage onto beats: root runs onto the enclosing human-turn, nested
 * runs onto the spawn with that `parentCallId`. Returns the conversation token
 * total when any usage was seen.
 */
export function attributeUsage(
  rows: AttributableRow[],
  transcript: TranscriptEvent[],
): number | undefined {
  const settled = settledRunIds(transcript);
  let tokenTotal = 0;
  let sawUsage = false;
  for (const event of transcript) {
    if (event.type !== "usage" && event.type !== "run_usage") continue;
    if (
      event.type === "usage" &&
      event.runId !== undefined &&
      settled.has(event.runId)
    ) {
      continue;
    }
    sawUsage = true;
    const tokens = usageTokenTotal(event.usage);
    tokenTotal += tokens;
    const row = targetRow(rows, event);
    if (!row) continue;
    addTokenTotal(row, tokens);
  }
  return sawUsage ? tokenTotal : undefined;
}
