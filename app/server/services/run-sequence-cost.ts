import type { TranscriptEvent } from "../schemas.js";

/** One run attributed to a beat. A legacy run has no `runId`. */
export type SequenceCostRun = {
  runId?: string;
  legacy: boolean;
  pending: boolean;
  status: "none" | "settled" | "unavailable";
  rawCostCents: number;
};

/** Runs whose cost rolls up with the thread-strip rules. */
export type SequenceCost = {
  runs: SequenceCostRun[];
};

type CostEvent = {
  type: "usage" | "run_usage" | "run_cost";
  runId?: string;
  status?: "settled" | "unavailable";
  cost?: { rawCostCents: number };
};

type AttributableBeat = {
  kind: "spawn" | "return" | "human-turn";
  parentCallId?: string;
  tokenTotal?: number;
  cost?: SequenceCost;
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

function emptyRun(runId: string | undefined, legacy: boolean): SequenceCostRun {
  return {
    ...(runId !== undefined ? { runId } : {}),
    legacy,
    pending: !legacy,
    status: "none",
    rawCostCents: 0,
  };
}

/** Fold one usage or cost event into a beat's run ledger. */
export function applyAttributedCost(
  cost: SequenceCost | undefined,
  event: CostEvent,
): SequenceCost {
  const runs = (cost?.runs ?? []).map((run) => ({ ...run }));
  if (event.type === "usage" || event.type === "run_usage") {
    if (event.runId === undefined) {
      if (!runs.some((run) => run.legacy)) runs.push(emptyRun(undefined, true));
      return { runs };
    }
    if (!runs.some((run) => run.runId === event.runId)) {
      runs.push(emptyRun(event.runId, false));
    }
    return { runs };
  }
  let row = runs.find((run) => run.runId === event.runId);
  if (!row) {
    row = emptyRun(event.runId, false);
    runs.push(row);
  }
  if (event.status === "settled" && event.cost) {
    row.pending = false;
    row.status = "settled";
    row.rawCostCents = event.cost.rawCostCents;
  } else if (event.status === "unavailable") {
    row.pending = false;
    row.status = "unavailable";
    row.rawCostCents = 0;
  }
  return { runs };
}

export function mergeSequenceCost(
  costs: Array<SequenceCost | undefined>,
): SequenceCost | undefined {
  const runs = costs.flatMap((cost) => cost?.runs ?? []);
  return runs.length > 0 ? { runs } : undefined;
}

function formatCostDollars(rawCostCents: number): string {
  return `$${(rawCostCents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Cost clause for a beat or header. `undefined` when every attributed run
 * is legacy: a settled total that can still change is `cost pending`.
 */
export function formatSequenceCostClause(
  cost: SequenceCost | undefined,
): string | undefined {
  if (cost === undefined || cost.runs.length === 0) return undefined;
  if (cost.runs.some((run) => !run.legacy && (run.pending || run.status === "none"))) {
    return "cost pending";
  }
  const settled = cost.runs.filter((run) => run.status === "settled");
  const n = settled.length;
  const m = cost.runs.length;
  if (n === 0) {
    return cost.runs.some((run) => run.status === "unavailable")
      ? "cost unavailable"
      : undefined;
  }
  const dollars = formatCostDollars(
    settled.reduce((sum, run) => sum + run.rawCostCents, 0),
  );
  if (n === m) return dollars;
  return `${dollars} (${n} of ${m} runs)`;
}

function settledRunIds(transcript: TranscriptEvent[]): Set<string> {
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

function addTokenTotal(row: AttributableRow, tokens: number): void {
  row.beat.tokenTotal = (row.beat.tokenTotal ?? 0) + tokens;
}

/**
 * Attribute usage and `run_cost` the same way: root runs onto the enclosing
 * human-turn, nested runs onto the spawn with that `parentCallId`.
 * Returns the conversation token total when any usage was seen.
 */
export function attributeUsageAndCost(
  rows: AttributableRow[],
  transcript: TranscriptEvent[],
): number | undefined {
  const settled = settledRunIds(transcript);
  let tokenTotal = 0;
  let sawUsage = false;
  for (const event of transcript) {
    if (
      event.type !== "usage" &&
      event.type !== "run_usage" &&
      event.type !== "run_cost"
    ) {
      continue;
    }
    const row = targetRow(rows, event);
    if (event.type === "run_cost") {
      if (row) row.beat.cost = applyAttributedCost(row.beat.cost, event);
      continue;
    }
    if (
      event.type === "usage" &&
      event.runId !== undefined &&
      settled.has(event.runId)
    ) {
      continue;
    }
    sawUsage = true;
    const tokens = event.usage.totalTokens;
    tokenTotal += tokens;
    if (!row) continue;
    addTokenTotal(row, tokens);
    row.beat.cost = applyAttributedCost(row.beat.cost, event);
  }
  return sawUsage ? tokenTotal : undefined;
}
