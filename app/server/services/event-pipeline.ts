import type { NestedStep, TranscriptEventInput } from "../schemas.js";
import { type AgentFailureClass } from "./agent-failure.js";
import { type AgentStreamEvent } from "./agent-sdk.js";
import { publishFrame } from "./conversation-stream.js";
import { appendEvent } from "./conversations.js";

/**
 * One step out of the session manager's single normalize pass. Persistence
 * writes only when `persist` is true (finalized events); every step is also
 * published to the live-subscriber tap, so `persist: false` steps surface the
 * incremental deltas that never touch disk.
 */
export type NormalizedStep = {
  event: TranscriptEventInput;
  persist: boolean;
};

/** Identity stamped onto every `subagent_update` from a bridge-hosted nested run. */
export type DelegationStamp = {
  delegationId: string;
  parentDelegationId?: string;
  model: string;
};

/**
 * Normalize + persist finalized events for one conversation turn, and publish
 * every normalized step to the live-subscriber tap ({@link emit}). Persistence
 * semantics are unchanged: only `persist: true` steps land on disk.
 */
export class EventPipeline {
  private assistantText = "";
  private nestedText = new Map<string, string>();
  private nestedThinking = new Map<string, string>();
  private delegationStamps = new Map<string, DelegationStamp>();

  constructor(private readonly conversationId: string) {}

  async handle(event: AgentStreamEvent): Promise<void> {
    if (event.kind === "message") {
      await this.handleMessage(event.message);
      return;
    }
    await this.handleNested(event.callId, event.update);
  }

  /**
   * Feed one event from a bridge-hosted nested run as `subagent_update` steps
   * keyed to the `delegate` tool call and stamped with the delegation fields.
   */
  async handleDelegation(
    parentCallId: string,
    stamp: DelegationStamp,
    event: AgentStreamEvent,
  ): Promise<void> {
    this.delegationStamps.set(parentCallId, stamp);
    if (event.kind === "nested") {
      await this.handleNested(parentCallId, event.update);
      return;
    }
    await this.handleDelegatedMessage(parentCallId, event.message);
  }

  /**
   * Live-only heartbeat for an in-flight nested run. Never persisted — keeps
   * SSE subscribers aware the run is still alive without padding the transcript.
   */
  async emitLiveness(
    parentCallId: string,
    stamp: DelegationStamp,
    elapsedMs: number,
  ): Promise<void> {
    this.delegationStamps.set(parentCallId, stamp);
    await this.emit({
      event: this.subagentUpdate(parentCallId, {
        kind: "liveness",
        elapsedMs,
      }),
      persist: false,
    });
  }

  async flush(): Promise<void> {
    await this.flushAssistant();
    for (const parentCallId of [...this.nestedText.keys()]) {
      await this.flushNestedText(parentCallId);
    }
    for (const parentCallId of [...this.nestedThinking.keys()]) {
      await this.flushNestedThinking(parentCallId);
    }
  }

  /** Persist a terminal `tool_call` when the SDK never completes one. */
  async failToolCall(
    callId: string,
    detail: {
      name: string;
      failureClass?: AgentFailureClass;
      message: string;
    },
  ): Promise<void> {
    await this.flushAssistant();
    const result: {
      status: "error";
      message: string;
      failureClass?: AgentFailureClass;
    } = { status: "error", message: detail.message };
    if (detail.failureClass !== undefined) {
      result.failureClass = detail.failureClass;
    }
    await this.emit({
      event: {
        type: "tool_call",
        callId,
        name: detail.name,
        status: "error",
        result,
      },
      persist: true,
    });
  }

  private async handleMessage(
    message: Extract<AgentStreamEvent, { kind: "message" }>["message"],
  ): Promise<void> {
    switch (message.type) {
      case "assistant": {
        const chunk = textFromAssistant(message);
        if (chunk) {
          this.assistantText += chunk;
          // Live-only delta for subscribers; the coalesced finalized text
          // flushes to disk on the next non-assistant event or end-of-turn.
          await this.emit({
            event: { type: "assistant", text: chunk },
            persist: false,
          });
        }
        return;
      }
      case "thinking": {
        await this.flushAssistant();
        await this.emit({
          event: { type: "thinking", text: message.text },
          persist: true,
        });
        return;
      }
      case "tool_call": {
        await this.flushAssistant();
        const hints = extractTaskHints(message.result);
        const event: TranscriptEventInput = {
          type: "tool_call",
          callId: message.call_id,
          status: message.status,
          ...(message.name ? { name: message.name } : {}),
          ...(message.args !== undefined ? { args: message.args } : {}),
          ...(message.result !== undefined ? { result: message.result } : {}),
          ...hints,
        };
        const terminal =
          message.status === "completed" || message.status === "error";
        await this.emit({ event, persist: terminal });
        return;
      }
      case "task": {
        await this.flushAssistant();
        await this.emit({
          event: {
            type: "task",
            ...(message.status !== undefined ? { status: message.status } : {}),
            ...(message.text !== undefined ? { text: message.text } : {}),
          },
          persist: true,
        });
        return;
      }
      case "status": {
        await this.flushAssistant();
        await this.emit({
          event: {
            type: "status",
            status: message.status,
            ...(message.message !== undefined
              ? { message: message.message }
              : {}),
          },
          persist: true,
        });
        return;
      }
      case "usage": {
        await this.flushAssistant();
        await this.emit({
          event: { type: "usage", usage: message.usage },
          persist: true,
        });
        return;
      }
      case "request": {
        await this.flushAssistant();
        await this.emit({
          event: { type: "request", requestId: message.request_id },
          persist: true,
        });
        return;
      }
      default:
        // system / user — not part of the app-owned transcript.
        return;
    }
  }

  /**
   * Translate a nested agent's top-level messages into nested-update shapes and
   * route through {@link handleNested} so persist-versus-live stays in one place.
   */
  private async handleDelegatedMessage(
    parentCallId: string,
    message: Extract<AgentStreamEvent, { kind: "message" }>["message"],
  ): Promise<void> {
    type NestedUpdate = Extract<
      AgentStreamEvent,
      { kind: "nested" }
    >["update"];

    switch (message.type) {
      case "assistant": {
        const chunk = textFromAssistant(message);
        if (!chunk) return;
        await this.handleNested(parentCallId, {
          type: "text-delta",
          text: chunk,
        } as NestedUpdate);
        return;
      }
      case "thinking": {
        await this.handleNested(parentCallId, {
          type: "thinking-delta",
          text: message.text,
        } as NestedUpdate);
        return;
      }
      case "tool_call": {
        if (message.status === "running") {
          await this.handleNested(parentCallId, {
            type: "tool-call-started",
            callId: message.call_id,
            toolCall: {
              ...(typeof message.name === "string"
                ? { type: message.name }
                : {}),
              ...(message.args !== undefined ? { args: message.args } : {}),
            },
          } as NestedUpdate);
          return;
        }
        // Preserve message-level error status when the result payload does not
        // already carry `{ status: "error" }` for handleNested's check.
        let result = message.result;
        if (
          message.status === "error" &&
          !(
            result &&
            typeof result === "object" &&
            (result as { status?: unknown }).status === "error"
          )
        ) {
          result = { status: "error" };
        }
        await this.handleNested(parentCallId, {
          type: "tool-call-completed",
          callId: message.call_id,
          toolCall: {
            ...(typeof message.name === "string" ? { type: message.name } : {}),
            ...(message.args !== undefined ? { args: message.args } : {}),
            ...(result !== undefined ? { result } : {}),
          },
        } as NestedUpdate);
        return;
      }
      default:
        return;
    }
  }

  private async handleNested(
    parentCallId: string,
    update: Extract<AgentStreamEvent, { kind: "nested" }>["update"],
  ): Promise<void> {
    const u = update as {
      type?: string;
      text?: string;
      callId?: string;
      toolCall?: { type?: string; args?: unknown; result?: unknown };
      stepId?: number;
    };

    switch (u.type) {
      case "text-delta": {
        await this.flushNestedThinking(parentCallId);
        if (typeof u.text === "string") {
          this.nestedText.set(
            parentCallId,
            (this.nestedText.get(parentCallId) ?? "") + u.text,
          );
          await this.emit({
            event: this.subagentUpdate(parentCallId, {
              kind: "text",
              text: u.text,
            }),
            persist: false,
          });
        }
        return;
      }
      case "thinking-delta": {
        await this.flushNestedText(parentCallId);
        if (typeof u.text === "string") {
          this.nestedThinking.set(
            parentCallId,
            (this.nestedThinking.get(parentCallId) ?? "") + u.text,
          );
          await this.emit({
            event: this.subagentUpdate(parentCallId, {
              kind: "thinking",
              text: u.text,
            }),
            persist: false,
          });
        }
        return;
      }
      case "thinking-completed": {
        await this.flushNestedText(parentCallId);
        await this.flushNestedThinking(parentCallId);
        return;
      }
      case "tool-call-started": {
        await this.flushNestedText(parentCallId);
        await this.flushNestedThinking(parentCallId);
        if (typeof u.callId !== "string") return;
        const step: NestedStep = {
          kind: "tool_call",
          callId: u.callId,
          status: "running",
          ...(typeof u.toolCall?.type === "string"
            ? { name: u.toolCall.type }
            : {}),
          ...(u.toolCall?.args !== undefined ? { args: u.toolCall.args } : {}),
        };
        await this.emit({
          event: this.subagentUpdate(parentCallId, step),
          persist: false,
        });
        return;
      }
      case "tool-call-completed": {
        await this.flushNestedText(parentCallId);
        await this.flushNestedThinking(parentCallId);
        if (typeof u.callId !== "string") return;
        const result = u.toolCall?.result;
        const status =
          result &&
          typeof result === "object" &&
          (result as { status?: unknown }).status === "error"
            ? "error"
            : "completed";
        const step: NestedStep = {
          kind: "tool_call",
          callId: u.callId,
          status,
          ...(typeof u.toolCall?.type === "string"
            ? { name: u.toolCall.type }
            : {}),
          ...(u.toolCall?.args !== undefined ? { args: u.toolCall.args } : {}),
          ...(result !== undefined ? { result } : {}),
        };
        await this.emit({
          event: this.subagentUpdate(parentCallId, step),
          persist: true,
        });
        return;
      }
      case "step-started": {
        await this.flushNestedText(parentCallId);
        await this.flushNestedThinking(parentCallId);
        if (typeof u.stepId !== "number") return;
        await this.emit({
          event: this.subagentUpdate(parentCallId, {
            kind: "step",
            stepId: u.stepId,
            status: "started",
          }),
          persist: true,
        });
        return;
      }
      case "step-completed": {
        await this.flushNestedText(parentCallId);
        await this.flushNestedThinking(parentCallId);
        if (typeof u.stepId !== "number") return;
        await this.emit({
          event: this.subagentUpdate(parentCallId, {
            kind: "step",
            stepId: u.stepId,
            status: "completed",
          }),
          persist: true,
        });
        return;
      }
      default:
        // partial-tool-call and unknown shapes — drop for persistence.
        return;
    }
  }

  private subagentUpdate(
    parentCallId: string,
    step: NestedStep,
  ): TranscriptEventInput {
    const stamp = this.delegationStamps.get(parentCallId);
    return {
      type: "subagent_update",
      parentCallId,
      step,
      ...(stamp
        ? {
            delegationId: stamp.delegationId,
            ...(stamp.parentDelegationId !== undefined
              ? { parentDelegationId: stamp.parentDelegationId }
              : {}),
            model: stamp.model,
          }
        : {}),
    };
  }

  private async flushAssistant(): Promise<void> {
    if (!this.assistantText) return;
    const text = this.assistantText;
    this.assistantText = "";
    await this.emit({ event: { type: "assistant", text }, persist: true });
  }

  private async flushNestedText(parentCallId: string): Promise<void> {
    const text = this.nestedText.get(parentCallId);
    if (!text) return;
    this.nestedText.delete(parentCallId);
    await this.emit({
      event: this.subagentUpdate(parentCallId, { kind: "text", text }),
      persist: true,
    });
  }

  private async flushNestedThinking(parentCallId: string): Promise<void> {
    const text = this.nestedThinking.get(parentCallId);
    if (!text) return;
    this.nestedThinking.delete(parentCallId);
    await this.emit({
      event: this.subagentUpdate(parentCallId, { kind: "thinking", text }),
      persist: true,
    });
  }

  private async emit(step: NormalizedStep): Promise<void> {
    publishFrame(this.conversationId, step);
    if (step.persist) {
      await appendEvent(this.conversationId, step.event);
    }
  }
}

function textFromAssistant(
  message: Extract<
    Extract<AgentStreamEvent, { kind: "message" }>["message"],
    { type: "assistant" }
  >,
): string {
  let out = "";
  for (const block of message.message.content) {
    if (block.type === "text") out += block.text;
  }
  return out;
}

/**
 * Post-completion hints off a Task/Agent `tool_call.result`. The SDK's task
 * result wraps them in a `{ status, value }` envelope; the app-hosted
 * `delegate` bridge returns them flat. Read whichever shape arrived.
 */
export function extractTaskHints(
  result: unknown,
): Pick<
  Extract<TranscriptEventInput, { type: "tool_call" }>,
  "resultAgentId" | "transcriptPath"
> {
  const outer = asRecord(result);
  if (!outer) return {};
  const r = asRecord(outer.value) ?? outer;
  return {
    ...(typeof r.agentId === "string" && r.agentId.trim()
      ? { resultAgentId: r.agentId.trim() }
      : {}),
    ...(typeof r.transcriptPath === "string" && r.transcriptPath.trim()
      ? { transcriptPath: r.transcriptPath.trim() }
      : {}),
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}
