// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranscriptEvent } from "@server/schemas";
import { deriveSubAgents, type SubAgent } from "../lib/subagent";
import { SubagentCard } from "./subagent-card";

const AT = "2026-10-30T00:00:00.000Z";
const RESUME_AGENT_ID = "bc-nested-resume";

const writeText = vi.fn();

type Unstamped<E> = E extends unknown ? Omit<E, "at"> : never;

function at(event: Unstamped<TranscriptEvent>): TranscriptEvent {
  return { ...event, at: AT };
}

function delegateStep(callId: string, role: string) {
  return {
    kind: "tool_call" as const,
    callId,
    name: "mcp",
    status: "running" as const,
    args: {
      providerIdentifier: "custom-user-tools",
      toolName: "delegate",
      args: { role, prompt: `Prompt for ${role}.` },
    },
  };
}

/** Root delegate → review → validator → author. */
function chain(): TranscriptEvent[] {
  return [
    at({
      type: "tool_call",
      callId: "call-review",
      name: "mcp",
      status: "running",
      args: {
        providerIdentifier: "custom-user-tools",
        toolName: "delegate",
        args: { role: "story-review", prompt: "Prompt for story-review." },
      },
    }),
    at({
      type: "subagent_update",
      parentCallId: "call-review",
      delegationId: "del-review",
      step: delegateStep("call-validator", "runtime-validator"),
    }),
    at({
      type: "subagent_update",
      parentCallId: "call-validator",
      delegationId: "del-validator",
      parentDelegationId: "del-review",
      step: delegateStep("call-author", "mockup-author"),
    }),
    at({
      type: "subagent_update",
      parentCallId: "call-author",
      delegationId: "del-author",
      parentDelegationId: "del-validator",
      step: { kind: "text", text: "Rendering captures." },
    }),
  ];
}

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function mountSubagentCard(agent: SubAgent): HTMLDivElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<SubagentCard agent={agent} />);
  });
  return container;
}

function mount(events: TranscriptEvent[]): HTMLDivElement {
  const [agent] = deriveSubAgents(events);
  return mountSubagentCard(agent!);
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

function card(host: ParentNode, callId: string): HTMLDetailsElement | null {
  return host.querySelector<HTMLDetailsElement>(
    `details[data-event="subagent"][data-call-id="${callId}"]`,
  );
}

function showThread(details: HTMLDetailsElement) {
  const button = Array.from(
    details.querySelectorAll<HTMLButtonElement>("button"),
  ).find((b) => b.closest("details") === details);
  expect(button?.textContent).toBe("Show thread");
  act(() => button!.click());
}

describe("SubagentCard copy resume agent id", () => {
  it("copies resumeAgentId from the summary row when present", async () => {
    const agent: SubAgent = {
      callId: "call-task-1",
      role: "issue-tracker-implementor",
      status: "completed",
      resumeAgentId: RESUME_AGENT_ID,
      steps: [],
      nestedRuns: [],
    };
    const host = mountSubagentCard(agent);
    const button = host.querySelector<HTMLButtonElement>(
      '[data-testid="copy-resume-agent-id-call-task-1"]',
    );
    expect(button).toBeTruthy();
    await act(async () => {
      button!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith(RESUME_AGENT_ID);
  });
});

describe("SubagentCard nested runs", () => {
  it("shows each depth as the same collapsed card behind Show thread", () => {
    const host = mount(chain());
    expect(card(host, "call-validator")).toBeNull();

    showThread(card(host, "call-review")!);
    const validator = card(host, "call-validator")!;
    expect(validator.open).toBe(false);
    expect(validator.textContent).toContain("runtime-validator");
    expect(validator.textContent).toContain("Prompt for runtime-validator.");

    showThread(validator);
    const author = card(host, "call-author")!;
    expect(author.open).toBe(false);
    expect(author.textContent).toContain("Prompt for mockup-author.");

    showThread(author);
    expect(author.textContent).toContain("Rendering captures.");
    expect(host.querySelector("textarea")).toBeNull();
    expect(host.querySelector('[data-nested="collapsed-delegation"]')).toBeNull();
  });
});
