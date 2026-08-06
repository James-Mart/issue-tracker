import { useEffect, useState } from "react";
import { getConversationRun } from "../api/client";

/** Map a live run frame to the thread's run-active flag. */
export function runActiveFromFrame(status: "started" | "finished"): boolean {
  return status === "started";
}

/**
 * Merge GET /run seed state with live run frames from SSE.
 *
 * Stream frames take precedence once any run frame arrives; until then the
 * seeded server snapshot drives the flag (e.g. rejoining a mid-flight run).
 */
export function resolveRunActive(
  seed: { loaded: boolean; active: boolean },
  streamActive: boolean | null,
): boolean {
  if (streamActive !== null) return streamActive;
  return seed.loaded ? seed.active : false;
}

/**
 * Whether the open conversation has an in-flight agent run.
 *
 * Seeds from `GET /api/conversations/:id/run` on mount, conversation change,
 * and SSE reconnect, then follows live `run` frames on the event stream.
 */
export function useConversationRunActive(
  conversationId: string,
  streamActive: boolean | null,
  runResyncKey: number,
): { runActive: boolean } {
  const [seed, setSeed] = useState<{ loaded: boolean; active: boolean }>({
    loaded: false,
    active: false,
  });

  useEffect(() => {
    let cancelled = false;
    setSeed({ loaded: false, active: false });
    getConversationRun(conversationId)
      .then((state) => {
        if (!cancelled) {
          setSeed({ loaded: true, active: state.active });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSeed({ loaded: true, active: false });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, runResyncKey]);

  return {
    runActive: resolveRunActive(seed, streamActive),
  };
}
