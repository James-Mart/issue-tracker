import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { agentsKeys } from "../api/keys";
import { subscribeConversation } from "../lib/conversation-events-registry";
import {
  type ConversationEventsState,
} from "../lib/conversation-events-state";
import { patchChannelSessionActiveRunInCache } from "@/features/issues/lib/retire-channel-live-session";

export type { ConversationEventsState };
export {
  applyTranscriptEvent,
  beginReplayStaging,
  commitReplayStaging,
  foldStreamTranscriptFrame,
} from "../lib/conversation-events-state";

const idleState = (): ConversationEventsState => ({
  events: [],
  ready: false,
  streamRunActive: null,
  runResyncKey: 0,
  pendingText: undefined,
});

/**
 * Subscribe to `GET /api/conversations/:id/events`. Replays persisted
 * history on connect, then folds live frames into local thread state.
 * Tears down (and clears) when `conversationId` changes or the hook unmounts.
 *
 * Multiple callers for the same id share one registry-owned connection.
 * On (re)connect, persisted transcript and catch-up frames are staged into
 * a replay buffer and committed on the first `ping` (after both replays).
 * Prior folded state is left alone until that commit, so reconnect does not
 * blank the thread.
 */
export function useConversationEvents(
  conversationId: string | null | undefined,
): ConversationEventsState {
  const qc = useQueryClient();
  const [state, setState] = useState<ConversationEventsState>(idleState);
  const prevRef = useRef<ConversationEventsState | null>(null);

  useEffect(() => {
    if (!conversationId) {
      prevRef.current = null;
      setState(idleState());
      return;
    }
    const id = conversationId;
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
    });
  }, [conversationId, qc]);

  return state;
}
