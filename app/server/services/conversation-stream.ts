import { EventEmitter } from "events";
import type { NormalizedStep } from "./event-pipeline.js";

/**
 * A single live frame off the event pipeline. It carries the same normalized
 * step the persistence path sees, so subscribers can tell the incremental
 * live-only deltas (`persist: false`) apart from the finalized events that also
 * land on disk (`persist: true`).
 */
export type ConversationFrame = NormalizedStep;

export type ConversationFrameListener = (frame: ConversationFrame) => void;

const FRAME_EVENT = "frame";

// In-process per-conversation subscriber registry. An emitter exists only while
// something is subscribed; publishing to a conversation with no subscribers is
// a no-op (the live tap never buffers).
const emitters = new Map<string, EventEmitter>();

function emitterFor(conversationId: string): EventEmitter {
  let emitter = emitters.get(conversationId);
  if (!emitter) {
    emitter = new EventEmitter();
    // SSE fan-out: allow arbitrarily many concurrent subscribers per turn.
    emitter.setMaxListeners(0);
    emitters.set(conversationId, emitter);
  }
  return emitter;
}

/**
 * Publish one normalized step to every live subscriber of a conversation.
 * Delivery is isolated per subscriber: a throwing listener (e.g. a broken SSE
 * writer) can never propagate into the event pipeline's persistence path or
 * disrupt the other subscribers.
 */
export function publishFrame(
  conversationId: string,
  frame: ConversationFrame,
): void {
  const emitter = emitters.get(conversationId);
  if (!emitter) return;
  // `listeners()` returns a snapshot, so a listener that unsubscribes during
  // delivery does not perturb this pass.
  for (const listener of emitter.listeners(FRAME_EVENT)) {
    try {
      (listener as ConversationFrameListener)(frame);
    } catch {
      // Swallow subscriber faults — the live tap is best-effort and must not
      // compromise persistence or other subscribers.
    }
  }
}

/**
 * Subscribe to a conversation's live frames. Returns an unsubscribe function;
 * the per-conversation emitter is dropped once its last subscriber leaves.
 */
export function subscribeFrames(
  conversationId: string,
  listener: ConversationFrameListener,
): () => void {
  const emitter = emitterFor(conversationId);
  emitter.on(FRAME_EVENT, listener);
  return () => {
    emitter.off(FRAME_EVENT, listener);
    if (emitter.listenerCount(FRAME_EVENT) === 0) {
      emitters.delete(conversationId);
    }
  };
}
