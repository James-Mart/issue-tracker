import { existsSync, mkdirSync } from "fs";
import { randomUUID } from "crypto";
import { join } from "path";
import type { SDKCustomTool } from "@cursor/sdk";
import type { AgentRunResult, AgentSdk, AgentStreamEvent } from "./agent-sdk.js";
import {
  classifyAgentFailure,
  isContentEvent,
  isRetryableAgentFailure,
  type AgentFailureClass,
} from "./agent-failure.js";
import {
  appendDelegation,
  conversationExists,
  readConversation,
  readDelegations,
} from "./conversations.js";
import { IssueError } from "./errors.js";
import { readIssueOrThrow } from "./issues.js";
import { EventPipeline } from "./event-pipeline.js";
import {
  formatEffectiveModel,
  resolveModelSelection,
} from "./model-selection.js";
import { loadRoleBody, loadRoleModelPin } from "./role-bodies.js";
import { createAgentStackTools } from "./agent-stack-tools.js";
import { createSdkBugReportTools } from "./sdk-bug-report.js";

/** Interval for live-only nested-run liveness frames. */
export const NESTED_RUN_HEARTBEAT_MS = 5000;

/**
 * Cancel a nested run that never emits a content event. Roughly 1.8× the
 * observed healthy maximum time-to-first-content (~166s), and below the
 * upstream give-up at ~410s.
 */
export const NESTED_RUN_FIRST_CONTENT_TIMEOUT_MS = 300_000;

/** Maximum nested delegation depth (conversation root is 0). */
export const MAX_DELEGATION_DEPTH = 3;

export type DelegateResult =
  | { ok: true; agentId: string; reply: string }
  | {
      ok: false;
      failureClass: AgentFailureClass;
      isRetryable: boolean;
      message: string;
      agentId: string;
    };

function delegateFailureFromWait(
  waited: AgentRunResult,
  agentId: string,
): Extract<DelegateResult, { ok: false }> {
  const message =
    waited.status === "error"
      ? waited.error?.message ??
        `delegate: nested run ${waited.id} failed`
      : `delegate: nested run ${waited.id} was cancelled`;
  return {
    ok: false,
    failureClass: classifyAgentFailure(waited.status, waited.error),
    isRetryable: isRetryableAgentFailure(waited.error),
    message,
    agentId,
  };
}

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
  /**
   * Cursor runtime `conversation_id` for the root agent session (its agentId).
   * Nested delegates pass their own agentId into {@link buildCustomTools}.
   */
  getCursorConversationId?: () => string | undefined;
  /** Override agents directory (tests). Defaults to the plugin `agents/`. */
  agentsDir?: string;
  /**
   * Called with an `auth` failure once, before it is returned to the caller.
   * The nested run cannot recover on its own — it shares the workspace executor
   * with the handle awaiting this tool call, so nothing it retries can mint a
   * new token — which is why the failure has to travel up.
   */
  onAuthFailure?: (detail: {
    delegationId: string;
    agentId: string;
    message: string;
    parentCallId?: string;
  }) => void;
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
  stalledBeforeFirstContent: boolean;
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
 * settles on conversation cancel. Returns how many nested runs it cancelled
 * (queued waiters are not counted).
 */
export async function cancelConversationDelegations(
  conversationId: string,
): Promise<number> {
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
  return toCancel.length;
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

/** Optional `issueId`; absent/undefined → omit; present but invalid → error. */
function optionalIssueId(args: Record<string, unknown>): string | undefined {
  if (!("issueId" in args) || args.issueId === undefined) return undefined;
  if (typeof args.issueId !== "string" || args.issueId.length === 0) {
    throw new Error("delegate: missing or invalid issueId");
  }
  return args.issueId;
}

function requireKnownIssue(issueId: string): void {
  try {
    readIssueOrThrow(issueId);
  } catch (err) {
    if (err instanceof IssueError && err.code === "not_found") {
      throw new Error(`delegate: unknown issue "${issueId}"`);
    }
    throw err;
  }
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
    getCursorConversationId?: () => string | undefined,
  ): Record<string, SDKCustomTool> {
    // Bug filing rides along with delegation so every agent — root and nested
    // alike — can report an SDK defect it trips over, without each spawn site
    // having to assemble its own tool map.
    const customTools: Record<string, SDKCustomTool> = {
      ...createSdkBugReportTools(),
    };

    // Verification stack tools are session-scoped to the app conversation;
    // the Cursor conversation_id comes from this agent session's runtime id.
    if (options.conversationId && getCursorConversationId) {
      Object.assign(
        customTools,
        createAgentStackTools({
          conversationId: options.conversationId,
          getCursorConversationId,
        }),
      );
    }

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
        "Delegate work to a named role. The app selects the role's pinned model. Returns ok: true with agentId and reply on success; ok: false with failureClass (auth | agent-failed | cancelled | stalled-before-first-token | transport-exhausted), isRetryable, message, and agentId on a runtime failure. Caller errors throw.",
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
          issueId: {
            type: "string",
            description: "Tracker issue this run is being spawned for.",
          },
        },
        required: ["role", "prompt"],
      },
      execute: async (args, context) => {
        const role = requireString(args, "role");
        const prompt = requireString(args, "prompt");
        const resumeId = optionalResumeId(args);
        const issueId = optionalIssueId(args);
        if (issueId !== undefined) {
          requireKnownIssue(issueId);
        }

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
          stalledBeforeFirstContent: false,
          cancel: async () => {},
        };
        trackNested(concurrencyKey, tracked);
        let handle: Awaited<ReturnType<AgentSdk["createAgent"]>> | undefined;
        let pipeline: EventPipeline | undefined;
        let parentCallId: string | undefined;
        try {
          if (tracked.cancelled) {
            throw new Error("delegate: conversation cancelled");
          }

          const delegationId = randomUUID();
          const parentDelegationId = parent?.delegationId;
          parentCallId =
            typeof context.toolCallId === "string" &&
            context.toolCallId.length > 0
              ? context.toolCallId
              : undefined;
          pipeline =
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
            // Local SDK sessionId === agentId; hooks see it as conversation_id.
            const nestedCustomTools = buildCustomTools(
              {
                delegationId,
                depth: attemptedDepth,
              },
              () => resumeId,
            );
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

            const nestedCustomTools = buildCustomTools(
              {
                delegationId,
                depth: attemptedDepth,
              },
              () => agentId,
            );
            handle = await options.sdk.createAgent({
              cwd: options.cwd,
              model,
              agentId,
              storeDir: nestedStoreDir,
              customTools: nestedCustomTools,
            });
          }
          tracked.cancel = () => handle!.cancel();
          if (tracked.cancelled) {
            await handle.cancel();
            throw new Error("delegate: conversation cancelled");
          }

          const agentId = handle.agentId;
          const reportFailure = (
            waited: AgentRunResult,
          ): Extract<DelegateResult, { ok: false }> => {
            if (
              tracked.stalledBeforeFirstContent &&
              !tracked.cancelled &&
              waited.status === "cancelled"
            ) {
              return {
                ok: false,
                failureClass: "stalled-before-first-token",
                isRetryable: true,
                message: `delegate: nested run ${waited.id} stalled before first content`,
                agentId,
              };
            }
            const failure = delegateFailureFromWait(waited, agentId);
            if (failure.failureClass === "auth") {
              options.onAuthFailure?.({
                delegationId,
                agentId,
                message: failure.message,
                ...(parentCallId !== undefined ? { parentCallId } : {}),
              });
            }
            return failure;
          };

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
              ...(issueId !== undefined ? { issueId } : {}),
              ...(parentCallId !== undefined ? { parentCallId } : {}),
            });
          }

          const run = await handle.send(fullPrompt);
          let reply = "";
          const startedAt = Date.now();
          let heartbeat: ReturnType<typeof setInterval> | undefined;
          let firstContentTimeout: ReturnType<typeof setTimeout> | undefined;
          if (pipeline && parentCallId) {
            const callId = parentCallId;
            heartbeat = setInterval(() => {
              void pipeline.emitLiveness(callId, stamp, Date.now() - startedAt);
            }, NESTED_RUN_HEARTBEAT_MS);
          }
          firstContentTimeout = setTimeout(() => {
            tracked.stalledBeforeFirstContent = true;
            void handle!.cancel();
          }, NESTED_RUN_FIRST_CONTENT_TIMEOUT_MS);
          try {
            try {
              for await (const event of run) {
                if (
                  firstContentTimeout !== undefined &&
                  isContentEvent(event)
                ) {
                  clearTimeout(firstContentTimeout);
                  firstContentTimeout = undefined;
                }
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
                return reportFailure(waitedAfterAbort);
              }
              if (waitedAfterAbort.status === "error") {
                return reportFailure(waitedAfterAbort);
              }
              throw streamErr;
            }

            const waited = await run.wait();
            if (waited.status === "error") {
              return reportFailure(waited);
            }
            if (waited.status === "cancelled") {
              return reportFailure(waited);
            }
            return { ok: true, agentId, reply };
          } finally {
            if (heartbeat !== undefined) clearInterval(heartbeat);
            if (firstContentTimeout !== undefined) {
              clearTimeout(firstContentTimeout);
            }
          }
        } catch (err) {
          if (pipeline && parentCallId) {
            try {
              await pipeline.failToolCall(parentCallId, {
                name: "delegate",
                message: err instanceof Error ? err.message : String(err),
              });
            } catch {
              // Best-effort terminal event before the throw propagates.
            }
          }
          throw err;
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

  return buildCustomTools(null, options.getCursorConversationId);
}
