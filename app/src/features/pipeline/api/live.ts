import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { subscribeTopic } from "@/lib/ws/transport";
import { pipelineKeys } from "./keys";

const PIPELINE_RUNS_TOPIC = "pipeline:runs";

/** Refetch the runs list when the server signals a run started or finished. */
export function usePipelineRunsLive(): void {
  const qc = useQueryClient();

  useEffect(() => {
    const unsubscribe = subscribeTopic(PIPELINE_RUNS_TOPIC, () => {
      void qc.invalidateQueries({ queryKey: pipelineKeys.runs() });
    });
    return unsubscribe;
  }, [qc]);
}
