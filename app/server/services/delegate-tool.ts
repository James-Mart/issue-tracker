import { existsSync, mkdirSync } from "fs";
import { randomUUID } from "crypto";
import { join } from "path";
import type { AgentDefinition, SDKCustomTool } from "@cursor/sdk";
import type { AgentSdk, AgentStreamEvent } from "./agent-sdk.js";
import {
  appendDelegation,
  conversationExists,
  readConversation,
  readDelegations,
} from "./conversations.js";
import { EventPipeline } from "./event-pipeline.js";
import {
  formatEffectiveModel,
  resolveModelSelection,
} from "./model-selection.js";
import { loadRoleBody, loadRoleModelPin } from "./role-bodies.js";

/** Interval for live-only nested-run liveness frames. */
export const NESTED_RUN_HEARTBEAT_MS = 5000;

/** Maximum nested delegation depth (conversation root is 0). */
export const MAX_DELEGATION_DEPTH = 3;

/**
 * Max in-flight nested runs in one conversation. Covers the widest known
 * fan-out with headroom; further calls wait FIFO rather than failing.
 */
export const MAX_CONCURRENT_DELEGATIONS_PER_CONVERSATION = 6;

/**
 * Process-wide backstop on in-flight nested runs. High enough that normal
 * multi-conversation use never hits it; only genuine runaway does.
 */
export const MAX_CONCURRENT_DELEGATIONS_GLOBAL = 24;

export interface DelegateToolOptions {
  sdk: AgentSdk;
  cwd: string;
  /** Conversation agent-state directory; nested stores are created under it. */
  storeDir: string;
  /**
   * Conversation that receives nested-run `subagent_update` frames. When
   * omitted, the handler still runs the nested agent but does not publish.
   */
  conversationId?: string;
  agents?: Record<string, AgentDefinition>;
  /** Override agents directory (tests). Defaults to the plugin `agents/`. */
  agentsDir?: string;
}

type SlotWaiter = {
  convKey: string;
  resolve: () => void;
  reject: (err: Error) => void;
};

type SlotGate = {
  inFlight: number;
  waiters: SlotWaiter[];
};

type NestedRunTracker = {
  cancelled: boolean;
  cancel: () => Promise<void>;
};

const globalGate: SlotGate = { inFlight: 0, waiters: [] };
const conversationGates = new Map<string, SlotGate>();
const nestedRunsByConversation = new Map<string, Set<NestedRunTracker>>();

/** Test helper: clear process-wide concurrency accounting. */
export function resetDelegationConcurrencyForTests(): void {
  globalGate.inFlight = 0;
  globalGate.waiters.length = 0;
  conversationGates.clear();
  nestedRunsByConversation.clear();
}

/** Test helper: outstanding nested work for a conversation concurrency key. */
export function conversationDelegationOutstandingForTests(
  conversationId: string,
): { inFlight: number; queued: number; nestedTracked: number } {
  const gate = conversationGates.get(conversationId);
  const globalQueued = globalGate.waiters.filter(
    (w) => w.convKey === conversationId,
  ).length;
  return {
    inFlight: gate?.inFlight ?? 0,
    queued: (gate?.waiters.length ?? 0) + globalQueued,
    nestedTracked: nestedRunsByConversation.get(conversationId)?.size ?? 0,
  };
}

function conversationGate(key: string): SlotGate {
  let gate = conversationGates.get(key);
  if (!gate) {
    gate = { inFlight: 0, waiters: [] };
    conversationGates.set(key, gate);
  }
  return gate;
}

function tryAcquire(convGate: SlotGate): boolean {
  if (convGate.inFlight >= MAX_CONCURRENT_DELEGATIONS_PER_CONVERSATION) {
    return false;
  }
  if (globalGate.inFlight >= MAX_CONCURRENT_DELEGATIONS_GLOBAL) {
    return false;
  }
  convGate.inFlight += 1;
  globalGate.inFlight += 1;
  return true;
}

function wakeNext(gate: SlotGate): void {
  const next = gate.waiters.shift();
  if (next) next.resolve();
}

function releaseSlot(convKey: string, convGate: SlotGate): void {
  convGate.inFlight -= 1;
  globalGate.inFlight -= 1;
  wakeNext(convGate);
  wakeNext(globalGate);
  if (convGate.inFlight === 0 && convGate.waiters.length === 0) {
    conversationGates.delete(convKey);
  }
}

/**
 * Acquire a per-conversation + global concurrency slot. Waits FIFO when either
 * limit is saturated; never fails for concurrency. Rejects when the
 * conversation's queued waiters are dropped by
 * {@link cancelConversationDelegations}.
 */
async function acquireConcurrencySlot(
  convKey: string,
): Promise<() => void> {
  const convGate = conversationGate(convKey);
  while (!tryAcquire(convGate)) {
    await new Promise<void>((resolve, reject) => {
      const waiter: SlotWaiter = { convKey, resolve, reject };
      if (convGate.inFlight >= MAX_CONCURRENT_DELEGATIONS_PER_CONVERSATION) {
        convGate.waiters.push(waiter);
      } else {
        globalGate.waiters.push(waiter);
      }
    });
  }
  return () => releaseSlot(convKey, convGate);
}

function trackNested(convKey: string, tracker: NestedRunTracker): void {
  let set = nestedRunsByConversation.get(convKey);
  if (!set) {
    set = new Set();
    nestedRunsByConversation.set(convKey, set);
  }
  set.add(tracker);
}

function untrackNested(convKey: string, tracker: NestedRunTracker): void {
  const set = nestedRunsByConversation.get(convKey);
  if (!set) return;
  set.delete(tracker);
  if (set.size === 0) nestedRunsByConversation.delete(convKey);
}

/**
 * Cancel in-flight nested runs for a conversation and drop anything still
 * queued on its concurrency gates. Intended to run before the parent run
 * settles on conversation cancel.
 */
export async function cancelConversationDelegations(
  conversationId: string,
): Promise<void> {
  const err = new Error("delegate: conversation cancelled");
  const rejected: SlotWaiter[] = [];
  const convGate = conversationGates.get(conversationId);
  if (convGate) {
    rejected.push(...convGate.waiters.splice(0));
  }
  for (let i = globalGate.waiters.length - 1; i >= 0; i--) {
    if (globalGate.waiters[i]!.convKey === conversationId) {
      rejected.push(globalGate.waiters.splice(i, 1)[0]!);
    }
  }
  for (const waiter of rejected) {
    waiter.reject(err);
  }

  const tracked = nestedRunsByConversation.get(conversationId);
  const toCancel = tracked ? [...tracked] : [];
  await Promise.all(
    toCancel.map(async (entry) => {
      entry.cancelled = true;
      try {
        await entry.cancel();
      } catch {
        // Best-effort cancel of each nested handle.
      }
    }),
  );
}

function requireString(
  args: Record<string, unknown>,
  key: string,
): string {
  const value = args[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`delegate: missing or invalid ${key}`);
  }
  return value;
}

/** Optional `resumeId`; absent/undefined → create path; present but invalid → error. */
function optionalResumeId(args: Record<string, unknown>): string | undefined {
  if (!("resumeId" in args) || args.resumeId === undefined) return undefined;
  if (typeof args.resumeId !== "string" || args.resumeId.length === 0) {
    throw new Error("delegate: missing or invalid resumeId");
  }
  return args.resumeId;
}

function nestedStorePath(storeDir: string, agentId: string): string {
  return join(storeDir, "nested", agentId);
}

function assistantTextFromEvent(event: AgentStreamEvent): string {
  if (event.kind !== "message") return "";
  if (event.message.type !== "assistant") return "";
  let reply = "";
  for (const block of event.message.message.content) {
    if (block.type === "text") reply += block.text;
  }
  return reply;
}

type ParentFrame = {
  delegationId: string;
  depth: number;
};

/**
 * Build the `customTools` map containing the app-hosted `delegate` bridge.
 * Each nested agent receives tools closed over its parent frame so concurrent
 * siblings do not inflate depth or steal parentage from each other.
 */
export function createDelegateCustomTools(
  options: DelegateToolOptions,
): Record<string, SDKCustomTool> {
  /** Cap key when `conversationId` is omitted (one gate per tools factory). */
  const anonymousKey = `anonymous:${randomUUID()}`;
  const concurrencyKey = options.conversationId ?? anonymousKey;

  function buildCustomTools(
    parent: ParentFrame | null,
  ): Record<string, SDKCustomTool> {
    const customTools: Record<string, SDKCustomTool> = {};

    customTools.delegations = {
      description:
        "List nested delegations for this conversation, most recent first.",
      inputSchema: {
        type: "object",
        properties: {},
      },
      execute: async () => {
        if (
          !options.conversationId ||
          !conversationExists(options.conversationId)
        ) {
          return { delegations: [] };
        }
        const { meta } = readConversation(options.conversationId);
        if (!meta.agentId) {
          return { delegations: [] };
        }
        const delegations = readDelegations(options.conversationId)
          .slice()
          .reverse()
          .map(({ delegationId, agentId, role, model, at }) => ({
            delegationId,
            agentId,
            role,
            model,
            at,
          }));
        return {
          root: { agentId: meta.agentId },
          delegations,
        };
      },
    };

    customTools.delegate = {
      description:
        "Delegate work to a named role. The app selects the role's pinned model.",
      inputSchema: {
        type: "object",
        properties: {
          role: {
            type: "string",
            description: "Spawnable role name (agents/<role>.md).",
          },
          prompt: {
            type: "string",
            description: "Task prompt for the nested agent.",
          },
          resumeId: {
            type: "string",
            description:
              "Existing nested agent id to re-enter. When set, resumes that agent instead of creating one.",
          },
        },
        required: ["role", "prompt"],
      },
      execute: async (args, context) => {
        const role = requireString(args, "role");
        const prompt = requireString(args, "prompt");
        const resumeId = optionalResumeId(args);

        const attemptedDepth = (parent?.depth ?? 0) + 1;
        if (attemptedDepth > MAX_DELEGATION_DEPTH) {
          throw new Error(
            `delegate: maximum delegation depth is ${MAX_DELEGATION_DEPTH} (attempted depth ${attemptedDepth})`,
          );
        }

        const agentsDir = options.agentsDir;

        const pin = loadRoleModelPin(role, agentsDir);
        const model = resolveModelSelection(pin);
        // Fresh spawn injects the role body; resume skips it — the agent already
        // carries those instructions from the first turn.
        const fullPrompt =
          resumeId === undefined
            ? `${loadRoleBody(role, agentsDir)}\n\n${prompt}`
            : prompt;

        const release = await acquireConcurrencySlot(concurrencyKey);
        const tracked: NestedRunTracker = {
          cancelled: false,
          cancel: async () => {},
        };
        trackNested(concurrencyKey, tracked);
        let handle: Awaited<ReturnType<AgentSdk["createAgent"]>> | undefined;
        try {
          if (tracked.cancelled) {
            throw new Error("delegate: conversation cancelled");
          }

          const delegationId = randomUUID();
          const parentDelegationId = parent?.delegationId;
          const parentCallId =
            typeof context.toolCallId === "string" &&
            context.toolCallId.length > 0
              ? context.toolCallId
              : undefined;
          const pipeline =
            options.conversationId && parentCallId
              ? new EventPipeline(options.conversationId)
              : undefined;
          const stamp = {
            delegationId,
            ...(parentDelegationId !== undefined
              ? { parentDelegationId }
              : {}),
            model: formatEffectiveModel(model),
          };

          const nestedCustomTools = buildCustomTools({
            delegationId,
            depth: attemptedDepth,
          });

          if (resumeId !== undefined) {
            const nestedStoreDir = nestedStorePath(
              options.storeDir,
              resumeId,
            );
            if (!existsSync(nestedStoreDir)) {
              throw new Error(
                `delegate: unknown or unresumable agent ${resumeId}`,
              );
            }
            try {
              handle = await options.sdk.resumeAgent(
                resumeId,
                nestedStoreDir,
                {
                  cwd: options.cwd,
                  // Re-entry re-applies the role's pin rather than trusting the
                  // agent to carry it: the app names the model on every turn,
                  // and a resumed local agent has no selection of its own.
                  model,
                  agents: options.agents,
                  customTools: nestedCustomTools,
                },
              );
            } catch (err) {
              const detail =
                err instanceof Error ? err.message : String(err);
              throw new Error(
                `delegate: unknown or unresumable agent ${resumeId}: ${detail}`,
              );
            }
          } else {
            // Store path is keyed by agent id so a later resumeId can find it
            // without a side registry (and so persistence can rehydrate by id).
            const agentId = randomUUID();
            const nestedStoreDir = nestedStorePath(
              options.storeDir,
              agentId,
            );
            mkdirSync(nestedStoreDir, { recursive: true });

            handle = await options.sdk.createAgent({
              cwd: options.cwd,
              model,
              agentId,
              storeDir: nestedStoreDir,
              agents: options.agents,
              customTools: nestedCustomTools,
            });
          }
          tracked.cancel = () => handle!.cancel();
          if (tracked.cancelled) {
            await handle.cancel();
            throw new Error("delegate: conversation cancelled");
          }

          // conversationId doubles as a concurrency key in tests; only
          // persist when the conversation store is actually present.
          if (
            options.conversationId &&
            conversationExists(options.conversationId)
          ) {
            await appendDelegation(options.conversationId, {
              delegationId,
              agentId: handle.agentId,
              role,
              model: stamp.model,
              ...(parentDelegationId !== undefined
                ? { parentDelegationId }
                : {}),
            });
          }

          const run = await handle.send(fullPrompt);
          let reply = "";
          const startedAt = Date.now();
          let heartbeat: ReturnType<typeof setInterval> | undefined;
          if (pipeline && parentCallId) {
            const callId = parentCallId;
            heartbeat = setInterval(() => {
              void pipeline.emitLiveness(callId, stamp, Date.now() - startedAt);
            }, NESTED_RUN_HEARTBEAT_MS);
          }
          try {
            try {
              for await (const event of run) {
                reply += assistantTextFromEvent(event);
                if (pipeline && parentCallId) {
                  await pipeline.handleDelegation(parentCallId, stamp, event);
                }
              }
              if (pipeline) await pipeline.flush();
            } catch (streamErr) {
              if (pipeline) {
                try {
                  await pipeline.flush();
                } catch {
                  // Best-effort flush after a mid-run failure.
                }
              }
              // Prefer wait()'s terminal status (e.g. cancelled) over an
              // iterator abort error, matching the conversation pump.
              const waitedAfterAbort = await run.wait();
              if (waitedAfterAbort.status === "cancelled") {
                throw new Error(
                  `delegate: nested run ${waitedAfterAbort.id} was cancelled`,
                );
              }
              if (waitedAfterAbort.status === "error") {
                throw new Error(
                  waitedAfterAbort.error?.message ??
                    `delegate: nested run ${waitedAfterAbort.id} failed`,
                );
              }
              throw streamErr;
            }

            const waited = await run.wait();
            if (waited.status === "error") {
              throw new Error(
                waited.error?.message ??
                  `delegate: nested run ${waited.id} failed`,
              );
            }
            if (waited.status === "cancelled") {
              throw new Error(
                `delegate: nested run ${waited.id} was cancelled`,
              );
            }
            return { agentId: handle.agentId, reply };
          } finally {
            if (heartbeat !== undefined) clearInterval(heartbeat);
          }
        } finally {
          untrackNested(concurrencyKey, tracked);
          release();
          if (handle) {
            try {
              await handle[Symbol.asyncDispose]();
            } catch {
              // Best-effort dispose after the reply is collected.
            }
          }
        }
      },
    };

    return customTools;
  }

  return buildCustomTools(null);
}
