import {
  Agent,
  Cursor,
  CursorAgentError,
  type AgentOptions,
  type CursorRequestOptions,
  type InteractionUpdate,
  type ModelSelection,
  type NestedTaskUpdate,
  type Run,
  type SDKAgent,
  type SDKMessage,
  type SDKModel,
  type SendOptions,
} from "@cursor/sdk";
import { cursorApiKey } from "../config.js";

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
   * `{ cwd, settingSources: ["user", "project"] }` — consumers never re-specify
   * the local runtime or which config layers load.
   */
  createAgent(options: CreateAgentOptions): Promise<AgentHandle>;
  /** Rehydrate a previously created agent by id and keep driving it. */
  resumeAgent(agentId: string): Promise<AgentHandle>;
}

export interface CreateAgentOptions {
  cwd: string;
  model: ModelSelection;
  agentId?: string;
}

export interface AgentSendOptions {
  model?: ModelSelection;
}

/**
 * A live agent conversation. `send` merges the two SDK event sources into one
 * stream (see {@link AgentStreamEvent}); `cancel` stops the active run; disposing
 * releases the underlying SDK handle.
 */
export interface AgentHandle extends AsyncDisposable {
  readonly agentId: string;
  send(
    prompt: string,
    options?: AgentSendOptions,
  ): AsyncIterable<AgentStreamEvent>;
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

    async createAgent({ cwd, model, agentId }) {
      const sdkAgent = await deps.createSdkAgent({
        apiKey: deps.apiKey,
        model,
        agentId,
        local: { cwd, settingSources: ["user", "project"] },
      });
      return wrapAgent(sdkAgent);
    },

    async resumeAgent(agentId) {
      const sdkAgent = await deps.resumeSdkAgent(agentId, {
        apiKey: deps.apiKey,
      });
      return wrapAgent(sdkAgent);
    },
  };
}

/** The real, `@cursor/sdk`-backed boundary. */
export const agentSdk: AgentSdk = createAgentSdk();

function wrapAgent(sdkAgent: SDKAgent): AgentHandle {
  let activeRun: Run | undefined;

  return {
    agentId: sdkAgent.agentId,

    send(prompt, options = {}) {
      return mergeSend(sdkAgent, prompt, options, (run) => {
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
 * Drive one send to completion, merging `run.stream()` messages and `onDelta`
 * nested updates into one ordered async stream. `onDelta` pushes nested events
 * into a queue as the SDK fires them; a background pump forwards each
 * `run.stream()` message into the same queue. The queue closes once the stream
 * is exhausted and the run has reached a terminal state.
 */
async function* mergeSend(
  sdkAgent: SDKAgent,
  prompt: string,
  options: AgentSendOptions,
  onRun: (run: Run) => void,
): AsyncGenerator<AgentStreamEvent, void> {
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

  const pump = (async () => {
    try {
      for await (const message of run.stream()) {
        queue.push({ kind: "message", message });
      }
      await run.wait();
    } finally {
      queue.close();
    }
  })();

  try {
    yield* queue;
  } finally {
    await pump;
  }
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
