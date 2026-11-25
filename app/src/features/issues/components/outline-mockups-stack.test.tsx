// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { OutlineMockupStackStatus } from "@server/schemas";
import { OutlineMockupsStack } from "./outline-mockups-stack";

function status(patch: Partial<OutlineMockupStackStatus> = {}): OutlineMockupStackStatus {
  return {
    phase: "stopped",
    canRestore: false,
    treeMatchesPack: false,
    authorRun: "clean",
    directions: [],
    ...patch,
  };
}

function mount(value: OutlineMockupStackStatus, onStart = vi.fn(), onStop = vi.fn()) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <OutlineMockupsStack status={value} pending={false} onStart={onStart} onStop={onStop} />,
    );
  });
  return { container, onStart, onStop };
}

afterEach(() => {
  document.body.innerHTML = "";
});

it("stands the empty message alone when nothing can be restored", () => {
  const { container } = mount(status());
  expect(container.textContent).toContain("No mockups for this outline.");
  expect(container.querySelector("button")).toBeNull();
  expect(container.querySelector("[data-testid='outline-mockups-session']")).toBeNull();
});

it("starts a clean stack and names the bound session", () => {
  const { container, onStart } = mount(
    status({
      canRestore: true,
      sessionId: "agent-mockup",
      directions: ["split-index-canvas"],
    }),
  );
  expect(container.textContent).toContain("Storybook is not running.");
  expect(container.textContent).toContain("agent-mockup");
  expect(container.textContent).toContain("split-index-canvas");
  const button = Array.from(container.querySelectorAll("button")).find((el) =>
    el.textContent?.includes("Start mockups stack"),
  );
  act(() => {
    button?.click();
  });
  expect(onStart).toHaveBeenCalledOnce();
});

it("opens the bound session's Storybook and stops the viewer lease", () => {
  const { container, onStop } = mount(
    status({
      phase: "live",
      sessionId: "agent-mockup",
      canRestore: true,
    }),
  );
  const open = container.querySelector("[data-testid='outline-mockups-open']");
  expect(open?.getAttribute("href")).toBe("/mockups/agent-mockup/");
  expect(open?.getAttribute("target")).toBe("_blank");
  const stop = Array.from(container.querySelectorAll("button")).find((el) =>
    el.textContent?.includes("Stop stack"),
  );
  act(() => {
    stop?.click();
  });
  expect(onStop).toHaveBeenCalledOnce();
});

it("shows the command tail and retries a failed start", () => {
  const { container, onStart } = mount(
    status({
      phase: "failed",
      command: "npm install",
      outputTail: "EADDRINUSE",
      sessionId: "agent-mockup",
      canRestore: true,
    }),
  );
  expect(container.textContent).toContain("Storybook failed to start");
  expect(container.textContent).toContain("> npm install");
  expect(container.textContent).toContain("EADDRINUSE");
  const retry = Array.from(container.querySelectorAll("button")).find((el) =>
    el.textContent?.includes("Retry"),
  );
  act(() => {
    retry?.click();
  });
  expect(onStart).toHaveBeenCalledOnce();
});
