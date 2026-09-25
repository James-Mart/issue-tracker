import type { TranscriptEvent } from "@server/schemas";

/** Running totals across every `usage` event in a transcript. */
export type UsageTotals = {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
};

function settledRunIds(events: readonly TranscriptEvent[]): Set<string> {
  const settled = new Set<string>();
  for (const event of events) {
    if (event.type === "run_usage") settled.add(event.runId);
  }
  return settled;
}

/** Sum usage so the header covers the whole conversation. A settled run counts its `run_usage` instead of that run's stream `usage` events. */
export function sumUsageTotals(
  events: readonly TranscriptEvent[],
): UsageTotals {
  const settled = settledRunIds(events);
  let totalTokens = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  for (const event of events) {
    if (event.type !== "usage" && event.type !== "run_usage") continue;
    if (
      event.type === "usage" &&
      event.runId !== undefined &&
      settled.has(event.runId)
    ) {
      continue;
    }
    totalTokens += event.usage.totalTokens;
    inputTokens += event.usage.inputTokens;
    outputTokens += event.usage.outputTokens;
  }
  return { totalTokens, inputTokens, outputTokens };
}

/** Compact run-state label for the thread header strip. */
export function threadRunLabel(runActive: boolean): "running" | "idle" {
  return runActive ? "running" : "idle";
}

/** Format cumulative usage for the thin header strip (tabular mono). */
export function formatUsageTotals(totals: UsageTotals): string {
  return (
    `${totals.totalTokens.toLocaleString()} tokens` +
    ` · in ${totals.inputTokens.toLocaleString()}` +
    ` · out ${totals.outputTokens.toLocaleString()}`
  );
}

type RunCostState = "none" | "settled" | "unavailable";

type CountedRun = {
  legacy: boolean;
  inFlight: boolean;
  cost: RunCostState;
  rawCostCents: number;
};

type RunSlot = {
  hasStreamUsage: boolean;
  hasRunUsage: boolean;
  cost: RunCostState;
  rawCostCents: number;
};

function emptySlot(): RunSlot {
  return {
    hasStreamUsage: false,
    hasRunUsage: false,
    cost: "none",
    rawCostCents: 0,
  };
}

/**
 * Prompt groups are the run boundaries the transcript already had. A group
 * with no `runId` and no `run_usage` is one legacy run.
 */
function countThreadRuns(
  events: readonly TranscriptEvent[],
  runActive: boolean,
): CountedRun[] {
  const byId = new Map<string, RunSlot>();
  const slot = (runId: string): RunSlot => {
    let row = byId.get(runId);
    if (!row) {
      row = emptySlot();
      byId.set(runId, row);
    }
    return row;
  };

  const groups: { hasRunId: boolean }[] = [];
  let current: { hasRunId: boolean } | null = null;
  let orphanLegacyUsage = false;

  for (const event of events) {
    if (event.type === "prompt") {
      current = { hasRunId: false };
      groups.push(current);
      continue;
    }
    if (event.type === "usage") {
      if (event.runId === undefined) {
        if (!current) orphanLegacyUsage = true;
        continue;
      }
      slot(event.runId).hasStreamUsage = true;
      if (current) current.hasRunId = true;
      continue;
    }
    if (event.type === "run_usage") {
      slot(event.runId).hasRunUsage = true;
      if (current) current.hasRunId = true;
      continue;
    }
    if (event.type === "run_cost") {
      const row = slot(event.runId);
      if (current) current.hasRunId = true;
      if (event.status === "settled" && event.cost) {
        row.cost = "settled";
        row.rawCostCents = event.cost.rawCostCents;
      } else if (event.status === "unavailable") {
        row.cost = "unavailable";
      }
    }
  }

  const runs: CountedRun[] = [];
  let sawInFlightId = false;
  for (const row of byId.values()) {
    const finished = row.hasRunUsage || row.cost !== "none";
    if (!finished) {
      sawInFlightId = true;
      runs.push({
        legacy: false,
        inFlight: true,
        cost: "none",
        rawCostCents: 0,
      });
      continue;
    }
    runs.push({
      legacy: false,
      inFlight: false,
      cost: row.cost,
      rawCostCents: row.rawCostCents,
    });
  }

  let legacyGroups = groups.filter((group) => !group.hasRunId);
  const last = groups[groups.length - 1];
  const openGroupIsAnonymous = runActive && last !== undefined && !last.hasRunId;
  if (openGroupIsAnonymous) {
    legacyGroups = legacyGroups.slice(0, -1);
  }
  if (runActive && !sawInFlightId) {
    runs.push({
      legacy: false,
      inFlight: true,
      cost: "none",
      rawCostCents: 0,
    });
  }

  for (const _group of legacyGroups) {
    runs.push({
      legacy: true,
      inFlight: false,
      cost: "none",
      rawCostCents: 0,
    });
  }
  if (orphanLegacyUsage) {
    runs.push({
      legacy: true,
      inFlight: false,
      cost: "none",
      rawCostCents: 0,
    });
  }
  return runs;
}

function formatCostDollars(rawCostCents: number): string {
  return `$${(rawCostCents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Cost clause for the thread strip. `null` when the conversation has only
 * legacy runs (or no runs): a settled total that can still change is never
 * returned — that case is `cost pending`.
 */
export function formatThreadCostClause(
  events: readonly TranscriptEvent[],
  runActive: boolean,
): string | null {
  const runs = countThreadRuns(events, runActive);
  if (
    runs.some(
      (run) => !run.legacy && (run.inFlight || run.cost === "none"),
    )
  ) {
    return "cost pending";
  }

  const settled = runs.filter((run) => run.cost === "settled");
  const n = settled.length;
  const m = runs.length;
  if (m === 0 || n === 0) {
    return runs.some((run) => run.cost === "unavailable")
      ? "cost unavailable"
      : null;
  }
  const dollars = formatCostDollars(
    settled.reduce((sum, run) => sum + run.rawCostCents, 0),
  );
  if (n === m) return dollars;
  return `${dollars} (${n} of ${m} runs)`;
}

/** Token clauses plus the cost clause, separated by ` · `. */
export function formatThreadStatus(
  events: readonly TranscriptEvent[],
  runActive: boolean,
): string {
  const usage = formatUsageTotals(sumUsageTotals(events));
  const cost = formatThreadCostClause(events, runActive);
  return cost === null ? usage : `${usage} · ${cost}`;
}
