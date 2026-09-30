import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ConversationStreamEvent } from "@server/schemas";
import {
  subscribeTopic,
  type TopicMessage,
} from "@/lib/ws/transport";
import { pipelineKeys } from "../api/keys";
import {
  applyLiveFrames,
  insertFrameBySeq,
} from "../live-run-sequence";
import type { RunSequence } from "../run-sequence";

function conversationTopic(conversationId: string): string {
  return `conversation:${conversationId}`;
}

/**
 * Overlay live conversation frames on the fetched run sequence so an
 * in-flight run advances without a reload. Completed and failed runs
 * do not subscribe.
 */
export function useLiveRunSequence(
  conversationId: string | undefined,
  fetched: RunSequence | undefined,
): RunSequence | undefined {
  const qc = useQueryClient();
  const framesRef = useRef<ConversationStreamEvent[]>([]);
  // The store object is a new identity on each publish. In-order inserts
  // append onto the same array, so the array itself cannot be the state.
  const [frameStore, setFrameStore] = useState<{
    frames: ConversationStreamEvent[];
  }>({ frames: framesRef.current });

  const publishFrames = useCallback((frames: ConversationStreamEvent[]) => {
    framesRef.current = frames;
    setFrameStore({ frames });
  }, []);

  useEffect(() => {
    publishFrames([]);
  }, [conversationId, publishFrames]);

  const sequence = fetched
    ? applyLiveFrames(fetched, frameStore.frames)
    : undefined;
  const shouldSubscribe = Boolean(
    conversationId && sequence?.condition === "in-flight",
  );

  useEffect(() => {
    if (!conversationId || !shouldSubscribe) return;
    let disposed = false;

    const onTopicMessage = (message: TopicMessage): void => {
      if (disposed) return;
      if (message.type === "reset") {
        publishFrames([]);
        void qc.invalidateQueries({
          queryKey: pipelineKeys.run(conversationId),
        });
        void qc.invalidateQueries({ queryKey: pipelineKeys.runs() });
        return;
      }
      const event = message.event as ConversationStreamEvent;
      const inserted = insertFrameBySeq(framesRef.current, event);
      if (!inserted.changed) return;
      publishFrames(inserted.frames);
    };

    const unsubscribe = subscribeTopic(
      conversationTopic(conversationId),
      onTopicMessage,
    );
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [conversationId, shouldSubscribe, qc, publishFrames]);

  return sequence;
}
