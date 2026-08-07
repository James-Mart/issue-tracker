import {
  Agent,
  Cursor,
  CursorAgentError,
  JsonlLocalAgentStore,
  composeLocalAgentStore,
  type AgentDefinition,
  type AgentOptions,
  type CursorRequestOptions,
  type InteractionUpdate,
  type ModelSelection,
  type NestedTaskUpdate,
  type Run,
  type SDKAgent,
  type SDKCustomTool,
  type SDKMessage,
  type SDKModel,
  type SendOptions,
} from "@cursor/sdk";
import { cursorApiKey } from "../config.js";
import { createAppendingRunEventsStore } from "./appending-run-events-store.js";
import { createCachedCheckpointsStore } from "./cached-checkpoints-store.js";

export { CursorAgentError };

/**
 * The single seam every SDK consumer in the app goes through. Consumers depend
 * on this narrow surface — never on `@cursor/sdk` directly — so the whole
 * feature stays verifiable with an injected fake and never spends tokens in the
 * default test suite.
 */
export interface AgentSdk {
  /** Models available to the authenticated key. */
  listModels(): Promise<SDKModel[]>;
  /**
   * Start a fresh local agent. `local` is always
   * `{ cwd, settingSources: ["user", "project", "plugins"] }` — consumers never
   * re-specify the local runtime or which config layers load. `"plugins"` is
   * required so plugin-packaged skills/agents (e.g. this issue-tracker plugin)
   * register on the Task tool the same way IDE chats do.
   */
  createAgent(options: CreateAgentOptions): Promise<AgentHandle>;
  /**
   * Rehydrate a previously created agent by id and keep driving it. `cwd` is
   * required and must be the workspace the agent was created in: the SDK scopes
   * a store lookup to that path, so resuming under any other one reports the
   * agent as missing. `model` is required because a resumed local agent does
   * not inherit the selection it was created with — without one, its next send
   * fails rather than falling back.
   */
  resumeAgent(
    agentId: string,
    storeDir: string,
    options: ResumeAgentOptions,
  ): Promise<AgentHandle>;
}

export interface CreateAgentOptions {
  cwd: string;
  model: ModelSelection;
  agentId?: string;
  storeDir: string;
  agents?: Record<string, AgentDefinition>;
  customTools?: Record<string, SDKCustomTool>;
}

export interface ResumeAgentOptions {
  cwd: string;
  model: ModelSelection;
  agents?: Record<string, AgentDefinition>;
  customTools?: Record<string, SDKCustomTool>;
}

export interface AgentSendOptions {
  model?: ModelSelection;
}

/**
 * Terminal outcome of one `send`. Mirrors the SDK's `RunResult` status so
 * callers can distinguish a finished run from a started-then-errored one
 * without importing `@cursor/sdk` types.
 */
export type AgentRunStatus = "finished" | "error" | "cancelled";

export interface AgentRunResult {
  id: string;
  status: AgentRunStatus;
  error?: { message: string; code?: string };
}

/**
 * A started run: its id is available immediately, the merged event stream is
 * async-iterable, and `wait()` resolves to the terminal {@link AgentRunResult}.
 * A thrown {@link CursorAgentError} from `send` means the run never started;
 * an `error` status from `wait()` means it started and failed.
 */
export interface AgentRun extends AsyncIterable<AgentStreamEvent> {
  readonly id: string;
  /** Model the SDK reported for this run, when available. */
  readonly model: ModelSelection | undefined;
  wait(): Promise<AgentRunResult>;
}

/**
 * A live agent conversation. `send` starts a run (eagerly — so never-started
 * failures reject the promise), merges the two SDK event sources into one
 * stream (see {@link AgentStreamEvent}), and returns the run handle; `cancel`
 * stops the active run; disposing releases the underlying SDK handle.
 */
export interface AgentHandle extends AsyncDisposable {
  readonly agentId: string;
  send(prompt: string, options?: AgentSendOptions): Promise<AgentRun>;
  cancel(): Promise<void>;
}

/**
 * One event out of the merged `send` stream, unifying the two SDK sources:
 *
 * - `message` — a top-level `SDKMessage` from the run's `run.stream()`.
 * - `nested` — a sub-agent update the boundary lifted out of an `onDelta`
 *   `tool-call-delta` interaction. `callId` is the parent Task tool call the
 *   nested thread belongs to; `modelCallId` is the SDK's model-call id; `update`
 *   is the `NestedTaskUpdate` payload.
 *
 * Only one nesting level is delivered: the SDK drops deeper `tool-call-delta`
 * at convert time and does not surface shell/edit interior deltas, and the
 * boundary mirrors that rather than trying to recover deeper levels.
 */
export type AgentStreamEvent =
  | { kind: "message"; message: SDKMessage }
  | {
      kind: "nested";
      callId: string;
      modelCallId: string;
      update: NestedTaskUpdate;
    };

/**
 * Injectable low-level SDK entry points. Defaults bind to `@cursor/sdk`; tests
 * pass fakes to exercise the boundary without a network or the real SDK.
 */
export interface AgentSdkDeps {
  createSdkAgent: (options: AgentOptions) => Promise<SDKAgent>;
  resumeSdkAgent: (
    agentId: string,
    options?: Partial<AgentOptions>,
  ) => Promise<SDKAgent>;
  listSdkModels: (options?: CursorRequestOptions) => Promise<SDKModel[]>;
  /** API key passed explicitly to every SDK call. */
  apiKey: string | undefined;
}

const defaultDeps: AgentSdkDeps = {
  createSdkAgent: (options) => Agent.create(options),
  resumeSdkAgent: (agentId, options) => Agent.resume(agentId, options),
  listSdkModels: (options) => Cursor.models.list(options),
  apiKey: cursorApiKey,
};

export function createAgentSdk(overrides: Partial<AgentSdkDeps> = {}): AgentSdk {
  const deps: AgentSdkDeps = { ...defaultDeps, ...overrides };

  return {
    async listModels() {
      return deps.listSdkModels({ apiKey: deps.apiKey });
    },

    async createAgent({ cwd, model, agentId, storeDir, agents, customTools }) {
      const sdkAgent = await deps.createSdkAgent({
        apiKey: deps.apiKey,
        model,
        agentId,
        agents,
        local: localRuntime(cwd, storeDir, customTools),
      });
      return wrapAgent(sdkAgent);
    },

    async resumeAgent(agentId, storeDir, { cwd, model, agents, customTools }) {
      const sdkAgent = await deps.resumeSdkAgent(agentId, {
        apiKey: deps.apiKey,
        model,
        agents,
        local: localRuntime(cwd, storeDir, customTools),
      });
      return wrapAgent(sdkAgent);
    },
  };
}

/**
 * The local runtime block both create and resume pass, built in one place so
 * the two can never drift. `cwd` carries twice the weight it looks like it
 * does: the SDK scopes store lookups to it (an agent persisted under one
 * workspace is invisible from another, and resume reports it as not found),
 * and it is also the directory the agent's tools run in. `settingSources` has
 * no default worth inheriting — omit it and the SDK loads no config layers at
 * all, which drops the plugin-packaged skills and agents this app relies on.
 */
function localRuntime(
  cwd: string,
  storeDir: string,
  customTools: Record<string, SDKCustomTool> | undefined,
): NonNullable<AgentOptions["local"]> {
  const jsonl = new JsonlLocalAgentStore(storeDir);
  return {
    cwd,
    settingSources: ["user", "project", "plugins"],
    store: composeLocalAgentStore({
      agents: jsonl.agents,
      runs: jsonl.runs,
      runEvents: createAppendingRunEventsStore(storeDir, jsonl.runEvents),
      checkpoints: createCachedCheckpointsStore(storeDir, jsonl.checkpoints),
    }),
    customTools,
  };
}

/** The real, `@cursor/sdk`-backed boundary. */
export const agentSdk: AgentSdk = createAgentSdk();

function wrapAgent(sdkAgent: SDKAgent): AgentHandle {
  let activeRun: Run | undefined;

  return {
    agentId: sdkAgent.agentId,

    send(prompt, options = {}) {
      return startSend(sdkAgent, prompt, options, (run) => {
        activeRun = run;
      });
    },

    async cancel() {
      if (activeRun && activeRun.supports("cancel")) {
        await activeRun.cancel();
      }
    },

    async [Symbol.asyncDispose]() {
      await sdkAgent[Symbol.asyncDispose]();
    },
  };
}

/**
 * Start one send: await the SDK run (so auth/config failures reject before a
 * handle exists), then merge `run.stream()` messages and `onDelta` nested
 * updates into one ordered async stream. `wait()` resolves with the SDK's
 * terminal result once the stream is exhausted.
 */
async function startSend(
  sdkAgent: SDKAgent,
  prompt: string,
  options: AgentSendOptions,
  onRun: (run: Run) => void,
): Promise<AgentRun> {
  const queue = new EventQueue<AgentStreamEvent>();

  const sendOptions: SendOptions = {
    model: options.model,
    onDelta: ({ update }) => {
      const nested = toNestedEvent(update);
      if (nested) queue.push(nested);
    },
  };

  const run = await sdkAgent.send(prompt, sendOptions);
  onRun(run);

  let settleWait!: (result: AgentRunResult) => void;
  const waitPromise = new Promise<AgentRunResult>((resolve) => {
    settleWait = resolve;
  });

  const pump = (async () => {
    let result: AgentRunResult = { id: run.id, status: "finished" };
    try {
      for await (const message of run.stream()) {
        queue.push({ kind: "message", message });
      }
      const waited = await run.wait();
      result = {
        id: waited.id,
        status: waited.status,
        ...(waited.error
          ? {
              error: {
                message: waited.error.message,
                ...(waited.error.code ? { code: waited.error.code } : {}),
              },
            }
          : {}),
      };
    } catch (err) {
      result = {
        id: run.id,
        status: "error",
        error: {
          message: err instanceof Error ? err.message : String(err),
        },
      };
    } finally {
      queue.close();
      settleWait(result);
    }
  })();

  return {
    id: run.id,
    model: run.model,
    wait: () => waitPromise,
    async *[Symbol.asyncIterator]() {
      try {
        yield* queue;
      } finally {
        await pump;
      }
    },
  };
}

/**
 * A single-consumer async queue bridging push-style producers (`onDelta`, the
 * stream pump) into one async iterator. Items pushed after `close()` are
 * dropped — late `onDelta` calls must not resurrect a finished stream.
 */
class EventQueue<T> {
  private readonly items: T[] = [];
  private closed = false;
  private resolveNext: (() => void) | undefined;

  push(item: T): void {
    if (this.closed) return;
    this.items.push(item);
    this.wake();
  }

  close(): void {
    this.closed = true;
    this.wake();
  }

  private wake(): void {
    this.resolveNext?.();
    this.resolveNext = undefined;
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T, void> {
    while (true) {
      while (this.items.length > 0) {
        yield this.items.shift() as T;
      }
      if (this.closed) return;
      await new Promise<void>((resolve) => {
        this.resolveNext = resolve;
      });
    }
  }
}

/**
 * Defensively lift a `tool-call-delta` interaction into a `nested` event.
 * The `onDelta` payload is undocumented and schema-unstable, so this never
 * throws on an unexpected shape — it returns `null` and the update is dropped.
 */
export function toNestedEvent(
  update: InteractionUpdate,
): Extract<AgentStreamEvent, { kind: "nested" }> | null {
  try {
    const u = update as {
      type?: unknown;
      callId?: unknown;
      modelCallId?: unknown;
      taskUpdate?: unknown;
    };
    if (u.type !== "tool-call-delta") return null;
    if (typeof u.callId !== "string" || typeof u.modelCallId !== "string") {
      return null;
    }
    const taskUpdate = u.taskUpdate as { type?: unknown } | null | undefined;
    if (!taskUpdate || typeof taskUpdate.type !== "string") return null;
    // Deeper nesting is already dropped by the SDK at convert time; mirror that
    // and never recurse into another tool-call-delta level.
    if (taskUpdate.type === "tool-call-delta") return null;
    return {
      kind: "nested",
      callId: u.callId,
      modelCallId: u.modelCallId,
      update: taskUpdate as NestedTaskUpdate,
    };
  } catch {
    return null;
  }
}
