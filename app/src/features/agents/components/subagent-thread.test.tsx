// @vitest-environment happy-dom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { NestedStep } from "@server/schemas";
import type { SubAgent } from "../lib/subagent";
import { SubagentThread } from "./subagent-thread";

function nestedTool(
  callId: string,
  status: "running" | "completed" | "error" = "completed",
  name = "Read",
  args?: unknown,
  result?: unknown,
): Extract<NestedStep, { kind: "tool_call" }> {
  return {
    kind: "tool_call",
    callId,
    name,
    status,
    ...(args !== undefined ? { args } : {}),
    ...(result !== undefined ? { result } : {}),
  };
}

function agent(overrides: Partial<SubAgent> = {}): SubAgent {
  return {
    callId: "parent-1",
    role: "implementor",
    status: "completed",
    steps: [],
    collapsedDelegations: [],
    ...overrides,
  };
}

function mountThread(props: ComponentProps<typeof SubagentThread>): {
  container: HTMLDivElement;
  root: Root;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<SubagentThread {...props} />);
  });
  return { container, root };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("SubagentThread Tool use groups", () => {
  it("folds consecutive ordinary nested tools into one collapsed Tool use block", () => {
    const { container } = mountThread({
      agent: agent({
        steps: [
          { kind: "thinking", text: "I will read both files." },
          nestedTool("c1", "completed", "Read", { path: "/tmp/a.ts" }),
          nestedTool("c2", "completed", "Read", { path: "/tmp/b.ts" }),
          { kind: "text", text: "Both files are in." },
        ],
      }),
    });

    const groups = container.querySelectorAll('[data-nested="tool_use_group"]');
    expect(groups).toHaveLength(1);
    const group = groups[0] as HTMLDetailsElement;
    expect(group.open).toBe(false);
    expect(group.getAttribute("data-tool-count")).toBe("2");
    expect(group.getAttribute("data-status")).toBe("completed");
    expect(group.querySelector("summary")!.textContent).toContain("Tool use");
    expect(group.querySelector("summary")!.textContent).toContain("2");

    const thinking = container.querySelector('[data-nested="thinking"]');
    expect(thinking).toBeTruthy();
    expect(thinking!.closest('[data-nested="tool_use_group"]')).toBeNull();

    const text = container.querySelector('[data-nested="text"]');
    expect(text).toBeTruthy();
    expect(text!.textContent).toContain("Both files are in.");
    expect(text!.closest('[data-nested="tool_use_group"]')).toBeNull();
  });

  it("auto-expands the group and errored nested tool row", () => {
    const { container } = mountThread({
      agent: agent({
        steps: [
          nestedTool("c1", "completed", "Read", { path: "/tmp/a.ts" }, "ok"),
          nestedTool(
            "c2",
            "error",
            "Shell",
            { command: "npm test" },
            "Command failed with exit code 1",
          ),
          nestedTool("c3", "completed", "Grep", { pattern: "foo" }, "no matches"),
        ],
      }),
    });

    const group = container.querySelector(
      '[data-nested="tool_use_group"]',
    ) as HTMLDetailsElement;
    expect(group.open).toBe(true);
    expect(group.getAttribute("data-status")).toBe("error");

    const errored = group.querySelector(
      "[data-call-id='c2']",
    ) as HTMLDetailsElement;
    expect(errored.open).toBe(true);
    expect(group.textContent).toContain("Command failed with exit code 1");

    const completed = group.querySelector(
      "[data-call-id='c1']",
    ) as HTMLDetailsElement;
    expect(completed.open).toBe(false);

    const sibling = group.querySelector(
      "[data-call-id='c3']",
    ) as HTMLDetailsElement;
    expect(sibling.open).toBe(false);
  });
});
