import type {
  ConversationStreamEvent,
  ConversationTranscriptPage,
} from "@server/schemas";
import { getConversationTranscript } from "../api/client";
import {
  holdTopicSeq,
  subscribeTopic,
  type TopicMessage,
} from "@/lib/ws/transport";
import {
  applyTranscriptDelta,
  foldTranscriptEvents,
  type ConversationEventsState,
} from "./conversation-events-state";

export type ConversationEventsListener = (
  state: ConversationEventsState,
) => void;

export type ConversationHistorySeed = ConversationTranscriptPage;

type ConversationEntry = {
  listeners: Set<ConversationEventsListener>;
  state: ConversationEventsState;
  dispose: () => void;
};

const entries = new Map<string, ConversationEntry>();

const emptyState = (): ConversationEventsState => ({
  events: [],
  ready: false,
  streamRunActive: null,
  runResyncKey: 0,
  pendingText: undefined,
});

function conversationTopic(conversationId: string): string {
  return `conversation:${conversationId}`;
}

function notify(entry: ConversationEntry): void {
  for (const listener of entry.listeners) {
    listener(entry.state);
  }
}

function openEntry(
  conversationId: string,
  seed: ConversationHistorySeed,
): ConversationEntry {
  const topic = conversationTopic(conversationId);
  let unsubscribeTopic: (() => void) | null = null;
  let disposed = false;
  let reseedGeneration = 0;
  let reseeding = false;
  const buffered: ConversationStreamEvent[] = [];

  const entry: ConversationEntry = {
    listeners: new Set(),
    state: {
      ...emptyState(),
      events: foldTranscriptEvents(seed.events),
      ready: true,
    },
    dispose: () => {
      disposed = true;
      unsubscribeTopic?.();
      unsubscribeTopic = null;
      reseedGeneration += 1;
      reseeding = false;
      buffered.length = 0;
    },
  };

  const setState = (patch: Partial<ConversationEventsState>): void => {
    entry.state = { ...entry.state, ...patch };
    notify(entry);
  };

  const applyLiveEvent = (event: ConversationStreamEvent): void => {
    if (reseeding) {
      buffered.push(event);
      return;
    }
    if (event.type === "run") {
      setState({ streamRunActive: event.status === "started" });
      return;
    }
    if (event.type === "pending") {
      setState({ pendingText: event.text });
      return;
    }
    entry.state = {
      ...entry.state,
      events: applyTranscriptDelta(entry.state.events, event),
    };
    notify(entry);
  };

  const reseedFromHistory = (): void => {
    // Keep the last good transcript painted while history reloads.
    const generation = ++reseedGeneration;
    reseeding = true;
    buffered.length = 0;
    entry.state = {
      ...entry.state,
      streamRunActive: null,
      runResyncKey: entry.state.runResyncKey + 1,
      pendingText: undefined,
    };
    notify(entry);

    void getConversationTranscript(conversationId)
      .then((page) => {
        if (disposed || generation !== reseedGeneration) return;
        entry.state = {
          ...entry.state,
          events: foldTranscriptEvents(page.events),
          ready: true,
        };
        holdTopicSeq(topic, page.latestSeq);
        const queued = buffered.splice(0, buffered.length);
        reseeding = false;
        notify(entry);
        for (const event of queued) {
          applyLiveEvent(event);
        }
      })
      .catch((err) => {
        if (disposed || generation !== reseedGeneration) return;
        reseeding = false;
        buffered.length = 0;
        if (import.meta.env.DEV) {
          console.warn(
            "conversation reset reseed failed:",
            conversationId,
            err,
          );
        }
      });
  };

  const onTopicMessage = (message: TopicMessage): void => {
    if (disposed) return;
    if (message.type === "reset") {
      reseedFromHistory();
      return;
    }
    applyLiveEvent(message.event as ConversationStreamEvent);
  };

  unsubscribeTopic = subscribeTopic(
    topic,
    onTopicMessage,
    seed.latestSeq > 0 ? seed.latestSeq : undefined,
  );

  return entry;
}

/**
 * Replace a live entry's painted history with a later GET page (tab-return
 * catch-up) without tearing the topic subscription down. No-op when no entry
 * is open — the subscribe path seeds the first page.
 */
export function applyConversationHistorySeed(
  conversationId: string,
  seed: ConversationHistorySeed,
): void {
  const entry = entries.get(conversationId);
  if (!entry) return;
  entry.state = {
    ...entry.state,
    events: foldTranscriptEvents(seed.events),
    ready: true,
  };
  if (seed.latestSeq > 0) {
    holdTopicSeq(conversationTopic(conversationId), seed.latestSeq);
  }
  notify(entry);
}

/**
 * Subscribe to a conversation's live topic. The first subscriber for an id
 * opens the shared transport subscription (after history was loaded via
 * react-query); later subscribers attach to the same stream and immediately
 * receive the current folded state; the last unsubscribe releases it.
 */
export function subscribeConversation(
  conversationId: string,
  listener: ConversationEventsListener,
  seed: ConversationHistorySeed,
): () => void {
  let entry = entries.get(conversationId);
  if (!entry) {
    entry = openEntry(conversationId, seed);
    entries.set(conversationId, entry);
  }
  entry.listeners.add(listener);
  listener(entry.state);
  return () => {
    entry.listeners.delete(listener);
    if (entry.listeners.size === 0) {
      entry.dispose();
      entries.delete(conversationId);
    }
  };
}

/** Tear down every live entry — for tests that install a fake transport. */
export function resetConversationEventsRegistryForTests(): void {
  for (const entry of entries.values()) {
    entry.dispose();
  }
  entries.clear();
}
