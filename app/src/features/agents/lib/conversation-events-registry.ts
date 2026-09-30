import type {
  ConversationStreamEvent,
  ConversationTranscriptPage,
  TranscriptEvent,
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
  idleConversationEventsState,
  joinLatestPage,
  pageEventSeq,
  prependOlderPage,
  type ConversationEventsState,
} from "./conversation-events-state";

export type ConversationEventsListener = (
  state: ConversationEventsState,
) => void;

export type ConversationHistorySeed = ConversationTranscriptPage;

type ConversationEntry = {
  listeners: Set<ConversationEventsListener>;
  state: ConversationEventsState;
  applyLatestPage: (seed: ConversationHistorySeed) => void;
  loadOlder: () => void;
  dispose: () => void;
};

const entries = new Map<string, ConversationEntry>();

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
  // Raw GET pages in seq order; live deltas fold into `state.events` only.
  let loadedPages: TranscriptEvent[] = seed.events;

  const entry: ConversationEntry = {
    listeners: new Set(),
    state: {
      ...idleConversationEventsState(),
      events: foldTranscriptEvents(seed.events),
      ready: true,
      hasOlder: seed.hasMore === true,
    },
    applyLatestPage: (page) => {
      const joined = joinLatestPage(loadedPages, entry.state.hasOlder, page);
      loadedPages = joined.events;
      entry.state = {
        ...entry.state,
        events: foldTranscriptEvents(joined.events),
        ready: true,
        hasOlder: joined.hasOlder,
        prependedRows: joined.joined ? entry.state.prependedRows : 0,
      };
    },
    loadOlder: () => {
      if (!entry.state.hasOlder || entry.state.olderStatus === "loading") {
        return;
      }
      const before = pageEventSeq(loadedPages[0]!);
      setState({ olderStatus: "loading" });
      void getConversationTranscript(conversationId, { before })
        .then((page) => {
          if (disposed) return;
          // A latest page that replaced the loaded range moved the cursor.
          if (loadedPages[0]?.seq !== before) {
            setState({ olderStatus: "idle" });
            return;
          }
          loadedPages = [...page.events, ...loadedPages];
          setState({
            ...prependOlderPage(entry.state, page),
            olderStatus: "idle",
          });
        })
        .catch(() => {
          if (disposed) return;
          setState({ olderStatus: "error" });
        });
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
    if (event.type === "steering") {
      setState({
        steeringText: event.text,
        pendingSteerFallback: false,
      });
      return;
    }
    if (event.type === "pending") {
      const matchesSteer =
        event.text !== null && event.text === entry.state.steeringText;
      const cleared = event.text === null;
      setState({
        pendingText: event.text,
        steeringText: matchesSteer ? null : entry.state.steeringText,
        pendingSteerFallback: matchesSteer
          ? true
          : cleared
            ? false
            : entry.state.pendingSteerFallback,
      });
      return;
    }
    if (event.type === "delegation" || event.type === "delegation_end") {
      return;
    }
    const deliveredSteer =
      event.type === "prompt" &&
      entry.state.steeringText !== null &&
      event.text === entry.state.steeringText;
    entry.state = {
      ...entry.state,
      events: applyTranscriptDelta(entry.state.events, event),
      ...(deliveredSteer ? { steeringText: null } : {}),
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
      steeringText: null,
      pendingSteerFallback: false,
    };
    notify(entry);

    void getConversationTranscript(conversationId)
      .then((page) => {
        if (disposed || generation !== reseedGeneration) return;
        entry.applyLatestPage(page);
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
 * catch-up) without tearing the topic subscription down. Older pages already
 * loaded stay when the page reaches back to them. No-op when no entry is
 * open — the subscribe path seeds the first page.
 */
export function applyConversationHistorySeed(
  conversationId: string,
  seed: ConversationHistorySeed,
): void {
  const entry = entries.get(conversationId);
  if (!entry) return;
  const steeringText = entry.state.steeringText;
  const delivered =
    steeringText !== null &&
    seed.events.some(
      (event) => event.type === "prompt" && event.text === steeringText,
    );
  entry.applyLatestPage(seed);
  if (delivered) entry.state = { ...entry.state, steeringText: null };
  if (seed.latestSeq > 0) {
    holdTopicSeq(conversationTopic(conversationId), seed.latestSeq);
  }
  notify(entry);
}

/**
 * Fetch and prepend the page older than the oldest loaded event. No-op when
 * no entry is open, no older events remain, or a page is already in flight.
 */
export function loadOlderConversationEvents(conversationId: string): void {
  entries.get(conversationId)?.loadOlder();
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
