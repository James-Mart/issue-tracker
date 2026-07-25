import { mkdirSync } from "fs";
import { randomUUID } from "crypto";
import { join } from "path";
import type { AgentDefinition, SDKCustomTool } from "@cursor/sdk";
import type { AgentSdk, AgentStreamEvent } from "./agent-sdk.js";
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

type SlotGate = {
  inFlight: number;
  waiters: Array<() => void>;
};

const globalGate: SlotGate = { inFlight: 0, waiters: [] };
const conversationGates = new Map<string, SlotGate>();

/** Test helper: clear process-wide concurrency accounting. */
export function resetDelegationConcurrencyForTests(): void {
  globalGate.inFlight = 0;
  globalGate.waiters.length = 0;
  conversationGates.clear();
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
  if (next) next();
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
 * limit is saturated; never fails for concurrency.
 */
async function acquireConcurrencySlot(
  convKey: string,
): Promise<() => void> {
  const convGate = conversationGate(convKey);
  while (!tryAcquire(convGate)) {
    await new Promise<void>((resolve) => {
      if (convGate.inFlight >= MAX_CONCURRENT_DELEGATIONS_PER_CONVERSATION) {
        convGate.waiters.push(resolve);
      } else {
        globalGate.waiters.push(resolve);
      }
    });
  }
  return () => releaseSlot(convKey, convGate);
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
        },
        required: ["role", "prompt"],
      },
      execute: async (args, context) => {
        const role = requireString(args, "role");
        const prompt = requireString(args, "prompt");

        const attemptedDepth = (parent?.depth ?? 0) + 1;
        if (attemptedDepth > MAX_DELEGATION_DEPTH) {
          throw new Error(
            `delegate: maximum delegation depth is ${MAX_DELEGATION_DEPTH} (attempted depth ${attemptedDepth})`,
          );
        }

        const agentsDir = options.agentsDir;

        const pin = loadRoleModelPin(role, agentsDir);
        const model = resolveModelSelection(pin);
        const roleBody = loadRoleBody(role, agentsDir);
        const fullPrompt = `${roleBody}\n\n${prompt}`;

        const release = await acquireConcurrencySlot(concurrencyKey);
        let handle: Awaited<ReturnType<AgentSdk["createAgent"]>> | undefined;
        try {
          const nestedStoreDir = join(options.storeDir, "nested", randomUUID());
          mkdirSync(nestedStoreDir, { recursive: true });

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

          handle = await options.sdk.createAgent({
            cwd: options.cwd,
            model,
            storeDir: nestedStoreDir,
            agents: options.agents,
            customTools: nestedCustomTools,
          });

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
            for await (const event of run) {
              reply += assistantTextFromEvent(event);
              if (pipeline && parentCallId) {
                await pipeline.handleDelegation(parentCallId, stamp, event);
              }
            }
            if (pipeline) await pipeline.flush();

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
          } catch (err) {
            if (pipeline) {
              try {
                await pipeline.flush();
              } catch {
                // Best-effort flush after a mid-run failure.
              }
            }
            throw err;
          } finally {
            if (heartbeat !== undefined) clearInterval(heartbeat);
          }
        } finally {
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
