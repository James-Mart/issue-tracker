import type { NestedStep, TranscriptEventInput } from "../schemas.js";
import { type AgentStreamEvent } from "./agent-sdk.js";
import { appendEvent } from "./conversations.js";

/**
 * One step out of the session manager's single normalize pass. Persistence
 * writes only when `persist` is true (finalized events). A later Story adds a
 * live-subscriber tap onto every step without changing that rule.
 */
export type NormalizedStep = {
  event: TranscriptEventInput;
  persist: boolean;
};

/**
 * Normalize + persist finalized events for one conversation turn. Live
 * subscribers are intentionally absent here; {@link emit} is the seam the
 * streaming Story will tap.
 */
export class EventPipeline {
  private assistantText = "";
  private nestedText = new Map<string, string>();
  private nestedThinking = new Map<string, string>();

  constructor(private readonly conversationId: string) {}

  async handle(event: AgentStreamEvent): Promise<void> {
    if (event.kind === "message") {
      await this.handleMessage(event.message);
      return;
    }
    await this.handleNested(event.callId, event.update);
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

  private async handleMessage(
    message: Extract<AgentStreamEvent, { kind: "message" }>["message"],
  ): Promise<void> {
    switch (message.type) {
      case "assistant": {
        const chunk = textFromAssistant(message);
        if (chunk) this.assistantText += chunk;
        // Live deltas later; finalized coalesced text flushes on the next
        // non-assistant event or at end-of-turn.
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
          event: { type: "subagent_update", parentCallId, step },
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
          event: { type: "subagent_update", parentCallId, step },
          persist: true,
        });
        return;
      }
      case "step-started": {
        await this.flushNestedText(parentCallId);
        await this.flushNestedThinking(parentCallId);
        if (typeof u.stepId !== "number") return;
        await this.emit({
          event: {
            type: "subagent_update",
            parentCallId,
            step: { kind: "step", stepId: u.stepId, status: "started" },
          },
          persist: true,
        });
        return;
      }
      case "step-completed": {
        await this.flushNestedText(parentCallId);
        await this.flushNestedThinking(parentCallId);
        if (typeof u.stepId !== "number") return;
        await this.emit({
          event: {
            type: "subagent_update",
            parentCallId,
            step: { kind: "step", stepId: u.stepId, status: "completed" },
          },
          persist: true,
        });
        return;
      }
      default:
        // partial-tool-call and unknown shapes — drop for persistence.
        return;
    }
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
      event: {
        type: "subagent_update",
        parentCallId,
        step: { kind: "text", text },
      },
      persist: true,
    });
  }

  private async flushNestedThinking(parentCallId: string): Promise<void> {
    const text = this.nestedThinking.get(parentCallId);
    if (!text) return;
    this.nestedThinking.delete(parentCallId);
    await this.emit({
      event: {
        type: "subagent_update",
        parentCallId,
        step: { kind: "thinking", text },
      },
      persist: true,
    });
  }

  private async emit(step: NormalizedStep): Promise<void> {
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

function extractTaskHints(
  result: unknown,
): Pick<
  Extract<TranscriptEventInput, { type: "tool_call" }>,
  "resultAgentId" | "transcriptPath"
> {
  if (!result || typeof result !== "object") return {};
  const r = result as Record<string, unknown>;
  return {
    ...(typeof r.agentId === "string" && r.agentId.trim()
      ? { resultAgentId: r.agentId.trim() }
      : {}),
    ...(typeof r.transcriptPath === "string" && r.transcriptPath.trim()
      ? { transcriptPath: r.transcriptPath.trim() }
      : {}),
  };
}
