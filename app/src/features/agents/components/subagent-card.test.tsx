// @vitest-environment happy-dom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { SubAgent } from "../lib/subagent";
import { SubagentCard } from "./subagent-card";

function completedAgent(overrides: Partial<SubAgent> = {}): SubAgent {
  return {
    callId: "call-delegation-1",
    role: "issue-tracker-implementor-composer",
    model: "composer-2.5",
    elapsedMs: 12000,
    prompt: "Work root: agents-chat. Issue: delegation-row. Mode: implement.",
    status: "completed",
    result: { reply: "Implemented delegation row." },
    steps: [{ kind: "text", text: "Reading instructions." }],
    collapsedDelegations: [],
    ...overrides,
  };
}

function mountCard(props: ComponentProps<typeof SubagentCard>): {
  container: HTMLDivElement;
  root: Root;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<SubagentCard {...props} />);
  });
  return { container, root };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("SubagentCard", () => {
  it("renders a completed delegation as one line with prompt and result hidden until expanded", () => {
    const { container } = mountCard({ agent: completedAgent() });

    const row = container.querySelector("[data-call-id='call-delegation-1']");
    expect(row).toBeTruthy();
    expect((row as HTMLDetailsElement).open).toBe(false);

    const summary = row!.querySelector("summary");
    expect(summary!.textContent).toContain("issue-tracker-implementor-composer");
    expect(summary!.textContent).toContain("composer-2.5");
    expect(summary!.textContent).toContain("12s");
    expect(summary!.textContent).not.toContain("Work root: agents-chat");
    expect(summary!.textContent).not.toContain("Implemented delegation row");

    act(() => {
      (summary as HTMLElement).click();
    });

    expect((row as HTMLDetailsElement).open).toBe(true);
    expect(container.textContent).toContain("Work root: agents-chat");
    expect(container.textContent).toContain("Implemented delegation row");
  });

  it("renders a failed delegation expanded with its result visible", () => {
    const { container } = mountCard({
      agent: completedAgent({
        status: "error",
        result: "Delegation failed: timeout",
      }),
    });

    const row = container.querySelector("[data-call-id='call-delegation-1']");
    expect(row).toBeTruthy();
    expect((row as HTMLDetailsElement).open).toBe(true);
    expect(container.textContent).toContain("Delegation failed: timeout");
  });
});
