import type { TranscriptEvent } from "@server/schemas";

/** Running totals across every `usage` event in a transcript. */
export type UsageTotals = {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
};

/** Sum `usage` events so the header covers the whole conversation. */
export function sumUsageTotals(events: TranscriptEvent[]): UsageTotals {
  let totalTokens = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  for (const event of events) {
    if (event.type !== "usage") continue;
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
