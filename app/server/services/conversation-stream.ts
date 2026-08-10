import { EventEmitter } from "events";
import { maxSeqFromTranscriptFile } from "./conversation-transcript-seq.js";
import type { ConversationFrameInput } from "../schemas.js";

/**
 * One live frame on the in-process subscriber tap. Carries a normalized
 * transcript step or live-only run signalling; `persist` distinguishes
 * incremental deltas from finalized events that also land on disk.
 */
export type ConversationFrame = {
  event: ConversationFrameInput;
  persist: boolean;
};

export type ConversationFrameListener = (frame: ConversationFrame) => void;

const FRAME_EVENT = "frame";

/** Max unpersisted frames retained per conversation for late SSE subscribers. */
export const CATCHUP_BUFFER_MAX_FRAMES = 256;

// In-process per-conversation subscriber registry. An emitter exists only while
// something is subscribed.
const emitters = new Map<string, EventEmitter>();

// Unpersisted frames since the last persisted append — replayed to subscribers
// that connect mid-run before live delivery begins.
const catchupBuffers = new Map<string, ConversationFrame[]>();

/** Highest seq assigned or read for each conversation this process. */
const seqByConversation = new Map<string, number>();
const seqInitialized = new Set<string>();

function ensureSeqInitialized(conversationId: string): void {
  if (seqInitialized.has(conversationId)) return;
  seqInitialized.add(conversationId);
  seqByConversation.set(
    conversationId,
    maxSeqFromTranscriptFile(conversationId),
  );
}

/**
 * Next monotonic seq for a conversation. When `existing` is set — e.g. a frame
 * already stamped by {@link publishFrame} — reuse it and advance the counter
 * floor without consuming another number.
 */
export function nextConversationSeq(
  conversationId: string,
  existing?: number,
): number {
  ensureSeqInitialized(conversationId);
  if (existing !== undefined) {
    const floor = seqByConversation.get(conversationId) ?? 0;
    if (existing > floor) {
      seqByConversation.set(conversationId, existing);
    }
    return existing;
  }
  const next = (seqByConversation.get(conversationId) ?? 0) + 1;
  seqByConversation.set(conversationId, next);
  return next;
}

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
function retainForCatchup(conversationId: string, frame: ConversationFrame): void {
  if (frame.persist) {
    catchupBuffers.delete(conversationId);
    return;
  }
  let buffer = catchupBuffers.get(conversationId);
  if (!buffer) {
    buffer = [];
    catchupBuffers.set(conversationId, buffer);
  }
  buffer.push(frame);
  if (buffer.length > CATCHUP_BUFFER_MAX_FRAMES) {
    buffer.splice(0, buffer.length - CATCHUP_BUFFER_MAX_FRAMES);
  }
}

/**
 * Snapshot of unpersisted frames buffered since the last persisted append.
 * Used by the SSE handler to catch up late subscribers before live delivery.
 */
export function getBufferedFrames(
  conversationId: string,
): readonly ConversationFrame[] {
  return catchupBuffers.get(conversationId) ?? [];
}

/** Drop a conversation's catch-up buffer (session teardown or delete). */
export function clearCatchupBuffer(conversationId: string): void {
  catchupBuffers.delete(conversationId);
}

export function publishFrame(
  conversationId: string,
  frame: ConversationFrame,
): void {
  const seq = nextConversationSeq(conversationId);
  Object.assign(frame.event, { seq });
  retainForCatchup(conversationId, frame);

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
