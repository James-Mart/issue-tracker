import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useConversationTranscriptQuery } from "../api/queries";
import { agentsKeys } from "../api/keys";
import { subscribeConversation } from "../lib/conversation-events-registry";
import {
  type ConversationEventsState,
} from "../lib/conversation-events-state";
import { patchChannelSessionActiveRunInCache } from "@/features/issues/lib/retire-channel-live-session";

export type { ConversationEventsState };
export {
  applyTranscriptDelta,
  applyTranscriptEvent,
  mergeTranscriptDeltas,
} from "../lib/conversation-events-state";

const idleState = (): ConversationEventsState => ({
  events: [],
  ready: false,
  streamRunActive: null,
  runResyncKey: 0,
  pendingText: undefined,
});

/**
 * Load persisted history through react-query (`GET …/transcript`), seed the
 * shared subscription registry from that result, then fold live topic deltas on
 * top in `seq` order. The stream itself no longer replays history.
 *
 * Multiple callers for the same id share one registry-owned topic subscription
 * on the tab's multiplexed WebSocket. Prior folded state is left alone across
 * reconnects so the thread does not blank while catch-up frames arrive.
 */
export function useConversationEvents(
  conversationId: string | null | undefined,
): ConversationEventsState {
  const qc = useQueryClient();
  const history = useConversationTranscriptQuery(conversationId);
  const [state, setState] = useState<ConversationEventsState>(idleState);
  const prevRef = useRef<ConversationEventsState | null>(null);
  // Prefer a settled mount fetch over a stale cache seed so reconnecting after
  // live persists does not open the stream on an outdated history page.
  // `!isFetching` covers tests that prime the cache with no network refetch.
  const historyReady =
    Boolean(conversationId) &&
    history.isSuccess &&
    history.data != null &&
    (history.isFetchedAfterMount || !history.isFetching);

  useEffect(() => {
    if (!historyReady || !conversationId || !history.data) {
      prevRef.current = null;
      setState(idleState());
      return;
    }
    const id = conversationId;
    const seed = history.data;
    prevRef.current = null;

    return subscribeConversation(id, (next) => {
      const prev = prevRef.current;
      prevRef.current = next;
      setState(next);
      // Skip cache work on the immediate snapshot delivered at subscribe —
      // late joiners must not re-invalidate for already-folded state.
      if (!prev) return;
      if (
        next.streamRunActive !== prev.streamRunActive &&
        next.streamRunActive !== null
      ) {
        void qc.invalidateQueries({
          queryKey: agentsKeys.conversationsPrefix(),
        });
        patchChannelSessionActiveRunInCache(qc, id, next.streamRunActive);
      }
      if (
        next.pendingText !== prev.pendingText &&
        next.pendingText !== undefined
      ) {
        void qc.invalidateQueries({
          queryKey: agentsKeys.conversationsPrefix(),
        });
      }
    }, seed);
    // Seed once history is settled for this id; background refetches must not
    // tear down a live subscription (do not depend on `history.data`).
  }, [conversationId, historyReady, qc]);

  return state;
}
