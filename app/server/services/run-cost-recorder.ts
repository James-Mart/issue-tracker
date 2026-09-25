import { Agent } from "@cursor/sdk";
import { cursorApiKey } from "../config.js";
import type {
  TranscriptEvent,
  TranscriptEventInput,
  UsageCost,
} from "../schemas.js";
import { publishFrame } from "./conversation-stream.js";
import {
  appendEvent,
  listConversationIds,
  readConversation,
} from "./conversations.js";

/** Poll offsets from run end: 5 s, 15 s, 45 s, 2 min, 5 min. */
export const RUN_COST_POLL_OFFSETS_MS = [
  5_000,
  15_000,
  45_000,
  120_000,
  300_000,
] as const;

export type RunUsageRecorded = {
  conversationId: string;
  runId: string;
  agentId: string;
  parentCallId?: string;
  /** Epoch ms when the run ended (live) or the `run_usage.at` timestamp (boot). */
  endedAt: number;
};

export type GetUsageSnapshot = {
  cost?: UsageCost;
};

export type GetUsageFn = (agentId: string) => Promise<GetUsageSnapshot>;

export interface RunCostRecorderClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export interface RunCostRecorderDeps {
  getUsage: GetUsageFn;
  clock: RunCostRecorderClock;
  logError: (message: string, err: unknown) => void;
}

type PendingRun = RunUsageRecorded;

type AgentQueueState = {
  pending: PendingRun[];
  active: Promise<void> | undefined;
};

function agentQueueKey(conversationId: string, agentId: string): string {
  return `${conversationId}:${agentId}`;
}

function subtractCost(current: UsageCost, previous: UsageCost | undefined): UsageCost {
  return {
    rawCostCents: current.rawCostCents - (previous?.rawCostCents ?? 0),
    chargedCents: current.chargedCents - (previous?.chargedCents ?? 0),
  };
}

function costsMatch(a: UsageCost, b: UsageCost): boolean {
  return (
    a.rawCostCents === b.rawCostCents && a.chargedCents === b.chargedCents
  );
}

export function previousSettledCumulative(
  transcript: TranscriptEvent[],
  agentId: string,
): UsageCost | undefined {
  let last: UsageCost | undefined;
  for (const event of transcript) {
    if (event.type !== "run_cost") continue;
    if (event.agentId !== agentId) continue;
    if (event.status !== "settled") continue;
    last = event.cumulative;
  }
  return last;
}

function hasRunCost(transcript: TranscriptEvent[], runId: string): boolean {
  return transcript.some(
    (event) => event.type === "run_cost" && event.runId === runId,
  );
}

function runUsageEventsForAgent(
  transcript: TranscriptEvent[],
  agentId: string,
): Extract<TranscriptEvent, { type: "run_usage" }>[] {
  return transcript.filter(
    (event): event is Extract<TranscriptEvent, { type: "run_usage" }> =>
      event.type === "run_usage" && event.agentId === agentId,
  );
}

async function persistRunCost(
  conversationId: string,
  event: Extract<TranscriptEventInput, { type: "run_cost" }>,
): Promise<void> {
  publishFrame(conversationId, { event, persist: true });
  await appendEvent(conversationId, event);
}

export function createRunCostRecorder(deps: RunCostRecorderDeps) {
  const queues = new Map<string, AgentQueueState>();

  async function appendUnavailable(run: PendingRun): Promise<void> {
    await persistRunCost(run.conversationId, {
      type: "run_cost",
      runId: run.runId,
      agentId: run.agentId,
      ...(run.parentCallId !== undefined ? { parentCallId: run.parentCallId } : {}),
      status: "unavailable",
    });
  }

  async function appendSettled(
    run: PendingRun,
    cumulative: UsageCost,
  ): Promise<void> {
    const { transcript } = readConversation(run.conversationId);
    const previous = previousSettledCumulative(transcript, run.agentId);
    const cost = subtractCost(cumulative, previous);
    await persistRunCost(run.conversationId, {
      type: "run_cost",
      runId: run.runId,
      agentId: run.agentId,
      ...(run.parentCallId !== undefined ? { parentCallId: run.parentCallId } : {}),
      status: "settled",
      cumulative,
      cost,
    });
  }

  async function pollRun(run: PendingRun): Promise<void> {
    let lastCost: UsageCost | undefined;

    for (const offsetMs of RUN_COST_POLL_OFFSETS_MS) {
      const targetTime = run.endedAt + offsetMs;
      const waitMs = Math.max(0, targetTime - deps.clock.now());
      if (waitMs > 0) {
        await deps.clock.sleep(waitMs);
      }

      let snapshot: GetUsageSnapshot;
      try {
        snapshot = await deps.getUsage(run.agentId);
      } catch (err) {
        deps.logError(
          `run cost getUsage failed for agent ${run.agentId} run ${run.runId}:`,
          err,
        );
        lastCost = undefined;
        continue;
      }

      const cost = snapshot.cost;
      if (cost === undefined) {
        lastCost = undefined;
        continue;
      }

      if (lastCost !== undefined && costsMatch(lastCost, cost)) {
        await appendSettled(run, cost);
        return;
      }

      lastCost = cost;
    }

    await appendUnavailable(run);
  }

  function drainQueue(key: string): void {
    const state = queues.get(key);
    if (!state || state.active !== undefined || state.pending.length === 0) {
      return;
    }

    const run = state.pending[0]!;
    state.active = pollRun(run)
      .catch((err) => {
        deps.logError(
          `run cost polling failed for conversation ${run.conversationId} run ${run.runId}:`,
          err,
        );
      })
      .finally(async () => {
        const current = queues.get(key);
        if (!current) return;
        current.pending.shift();
        current.active = undefined;
        drainQueue(key);
      });
  }

  function enqueue(run: PendingRun): void {
    const key = agentQueueKey(run.conversationId, run.agentId);
    let state = queues.get(key);
    if (!state) {
      state = { pending: [], active: undefined };
      queues.set(key, state);
    }
    state.pending.push(run);
    drainQueue(key);
  }

  return {
    onRunUsage(recorded: RunUsageRecorded): void {
      enqueue(recorded);
    },

    async resumeAtBoot(): Promise<void> {
      for (const conversationId of listConversationIds()) {
        try {
          const { transcript } = readConversation(conversationId);
          const agentIds = new Set<string>();
          for (const event of transcript) {
            if (event.type === "run_usage") agentIds.add(event.agentId);
          }

          for (const agentId of agentIds) {
            const missing = runUsageEventsForAgent(transcript, agentId).filter(
              (event) => !hasRunCost(transcript, event.runId),
            );
            if (missing.length === 0) continue;

            for (const event of missing.slice(0, -1)) {
              await appendUnavailable({
                conversationId,
                runId: event.runId,
                agentId: event.agentId,
                ...(event.parentCallId !== undefined
                  ? { parentCallId: event.parentCallId }
                  : {}),
                endedAt: Date.parse(event.at),
              });
            }

            const latest = missing[missing.length - 1]!;
            enqueue({
              conversationId,
              runId: latest.runId,
              agentId: latest.agentId,
              ...(latest.parentCallId !== undefined
                ? { parentCallId: latest.parentCallId }
                : {}),
              endedAt: Date.parse(latest.at),
            });
          }
        } catch (err) {
          deps.logError(
            `run cost boot resume failed for conversation ${conversationId}:`,
            err,
          );
        }
      }
    },
  };
}

const productionClock: RunCostRecorderClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

async function defaultGetUsage(agentId: string): Promise<GetUsageSnapshot> {
  const usage = await Agent.getUsage(agentId, { apiKey: cursorApiKey });
  return { cost: usage.cost };
}

export const runCostRecorder = createRunCostRecorder({
  getUsage: defaultGetUsage,
  clock: productionClock,
  logError: (message, err) => console.error(message, err),
});

/** Boot hook: resume cost polling for runs that ended before this process started. */
export async function resumeRunCostPollingAtBoot(): Promise<void> {
  await runCostRecorder.resumeAtBoot();
}
