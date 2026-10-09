import type { RecentRun } from "./run-list";
import type { RunSequence } from "./run-sequence";
import {
  tabTitleEntityName,
  useTabTitle,
} from "@/lib/tab-title/use-tab-title";
import { usePipelineRunQuery } from "./api/queries";

function runTabTitleName(
  conversationId: string,
  runs: RecentRun[],
  sequence: RunSequence | undefined,
): string {
  const runLabel =
    runs.find((run) => run.conversationId === conversationId)
      ?.coordinatorLabel ??
    sequence?.lifelines.find((lifeline) => lifeline.kind === "coordinator")
      ?.label;
  return tabTitleEntityName(runLabel, conversationId);
}

/** Tab title for the runs index and an open run's sequence view. */
export function usePipelineRunTabTitle(
  conversationId: string | undefined,
  runs: RecentRun[],
): void {
  const { data: sequence } = usePipelineRunQuery(conversationId);
  useTabTitle(
    conversationId ? runTabTitleName(conversationId, runs, sequence) : "Runs",
    conversationId ? "Run" : undefined,
  );
}
