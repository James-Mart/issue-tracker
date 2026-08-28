import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  parseConversationFrame,
  type ConversationStreamEvent,
} from "@server/schemas";
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
  const [frames, setFrames] = useState<ConversationStreamEvent[]>([]);

  useEffect(() => {
    setFrames([]);
  }, [conversationId]);

  const sequence = fetched ? applyLiveFrames(fetched, frames) : undefined;
  const shouldSubscribe = Boolean(
    conversationId && sequence?.condition === "in-flight",
  );

  useEffect(() => {
    if (!conversationId || !shouldSubscribe) return;
    let disposed = false;

    const onTopicMessage = (message: TopicMessage): void => {
      if (disposed) return;
      if (message.type === "reset") {
        setFrames([]);
        void qc.invalidateQueries({
          queryKey: pipelineKeys.run(conversationId),
        });
        void qc.invalidateQueries({ queryKey: pipelineKeys.runs() });
        return;
      }
      const parsed = parseConversationFrame(message.event);
      if (!parsed.ok) {
        if (import.meta.env.DEV) {
          console.warn(
            "ignoring malformed conversation event:",
            message.event,
            parsed.message,
          );
        }
        return;
      }
      setFrames((prev) => insertFrameBySeq(prev, parsed.event));
    };

    const unsubscribe = subscribeTopic(
      conversationTopic(conversationId),
      onTopicMessage,
    );
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [conversationId, shouldSubscribe, qc]);

  return sequence;
}
