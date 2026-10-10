import { EventEmitter } from "events";
import { maxSeqFromTranscriptTail } from "./conversation-transcript-seq.js";
import {
  parseConversationFrame,
  type ConversationFrameInput,
  type IssueEvent,
  type PipelineRunsEvent,
  type PrSyncEvent,
} from "../schemas.js";
import { PIPELINE_RUNS_TOPIC } from "./pipeline-runs-events.js";
import { PR_SYNC_TOPIC } from "./pr-sync-topic.js";

/** Non-conversation multiplex topic — frames are IssueEvent, not stream events. */
const ISSUES_TOPIC = "issues";

/**
 * One live frame on the in-process subscriber tap. Conversation topics carry
 * a normalized transcript step or live-only run signalling; the `issues`
 * topic carries filesystem watcher payloads. `persist` distinguishes
 * incremental deltas from finalized events that also land on disk.
 */
export type ConversationFrame = {
  event: (ConversationFrameInput | IssueEvent | PipelineRunsEvent | PrSyncEvent) & {
    seq?: number;
  };
  persist: boolean;
};

export type ConversationFrameListener = (frame: ConversationFrame) => void;

const FRAME_EVENT = "frame";

/** Max frames retained per stream key for late topic subscribers. */
export const CATCHUP_BUFFER_MAX_FRAMES = 256;

// In-process per-conversation subscriber registry. An emitter exists only while
// something is subscribed.
const emitters = new Map<string, EventEmitter>();

// Bounded window of recent published frames, indexed by seq — survives
// persisted appends so reconnecting clients can be served what they missed.
const catchupBuffers = new Map<string, ConversationFrame[]>();

export type FramesSinceResult =
  | { resetRequired: true }
  | { resetRequired: false; frames: readonly ConversationFrame[] };

/**
 * Write-through cache of the highest seq for each conversation. Appends
 * advance it. Absence means this process has not read that conversation yet,
 * including after {@link releaseConversationStream}.
 */
const seqByConversation = new Map<string, number>();

function ensureSeqInitialized(conversationId: string): number {
  const cached = seqByConversation.get(conversationId);
  if (cached !== undefined) return cached;
  const seq = maxSeqFromTranscriptTail(conversationId);
  seqByConversation.set(conversationId, seq);
  return seq;
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
  const floor = ensureSeqInitialized(conversationId);
  if (existing !== undefined) {
    if (existing > floor) {
      seqByConversation.set(conversationId, existing);
    }
    return existing;
  }
  const next = floor + 1;
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

function frameSeq(frame: ConversationFrame): number {
  const seq = frame.event.seq;
  if (typeof seq !== "number") {
    throw new Error("catch-up frame missing seq");
  }
  return seq;
}

/** Conversation streams persist a transcript. Issue, pipeline, and pr-sync topics do not. */
function isConversationStream(streamKey: string): boolean {
  return (
    streamKey !== ISSUES_TOPIC &&
    streamKey !== PIPELINE_RUNS_TOPIC &&
    streamKey !== PR_SYNC_TOPIC
  );
}

/**
 * Frames after `sinceSeq` still held in the catch-up window, in order.
 * An exact match replays from the buffer. A gap, or a `sinceSeq` that is
 * not the cached seq when the buffer is empty, sends `reset`. The first
 * empty-window check reads the transcript tail; later checks reuse the cache.
 */
export function getFramesSince(
  conversationId: string,
  sinceSeq: number,
): FramesSinceResult {
  const buffer = catchupBuffers.get(conversationId);
  if (!buffer || buffer.length === 0) {
    if (
      isConversationStream(conversationId) &&
      sinceSeq !== ensureSeqInitialized(conversationId)
    ) {
      return { resetRequired: true };
    }
    return { resetRequired: false, frames: [] };
  }
  const oldestSeq = frameSeq(buffer[0]!);
  const newestSeq = frameSeq(buffer[buffer.length - 1]!);
  if (sinceSeq < oldestSeq - 1 || sinceSeq > newestSeq) {
    return { resetRequired: true };
  }
  const frames = buffer.filter((frame) => frameSeq(frame) > sinceSeq);
  return { resetRequired: false, frames };
}

/**
 * Drop catch-up frames and in-memory seq bookkeeping. The next frame
 * continues from the last seq persisted in the transcript.
 */
export function releaseConversationStream(conversationId: string): void {
  catchupBuffers.delete(conversationId);
  seqByConversation.delete(conversationId);
}

export function publishFrame(
  conversationId: string,
  frame: ConversationFrame,
): void {
  const preassigned =
    typeof (frame.event as { seq?: unknown }).seq === "number"
      ? (frame.event as { seq: number }).seq
      : undefined;
  const seq = nextConversationSeq(conversationId, preassigned);
  // Clients parse live frames with `at` + `seq` required. Run/pending frames
  // are live-only and would otherwise be dropped after the SharedWorker hop.
  const existingAt = (frame.event as { at?: unknown }).at;
  const at =
    typeof existingAt === "string" && existingAt.length > 0
      ? existingAt
      : new Date().toISOString();
  Object.assign(frame.event, { seq, at });

  if (isConversationStream(conversationId)) {
    const parsed = parseConversationFrame(frame.event);
    if (!parsed.ok) {
      console.warn(
        "dropping malformed conversation frame:",
        conversationId,
        frame.event,
        parsed.message,
      );
      return;
    }
  }

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
