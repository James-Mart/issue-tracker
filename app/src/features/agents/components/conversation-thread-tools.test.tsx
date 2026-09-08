// @vitest-environment happy-dom
import {
  mountThread,
  renderThread,
  resetThreadMocks,
  transcriptState,
} from "./conversation-thread.test-helpers";
import { act } from "react";
import { type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

describe("ConversationThread Tool use groups", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    container = undefined;
    root = undefined;
    resetThreadMocks();
  });

  it("folds consecutive ordinary tools into one collapsed Tool use block", () => {
    transcriptState.events = [
      { type: "prompt", text: "Read the files", at: "2026-07-24T00:00:00.000Z" },
      {
        type: "thinking",
        text: "I will read both files.",
        at: "2026-07-24T00:00:01.000Z",
      },
      {
        type: "tool_call",
        callId: "c1",
        name: "Read",
        status: "completed",
        args: { path: "/tmp/a.ts" },
        at: "2026-07-24T00:00:02.000Z",
      },
      {
        type: "tool_call",
        callId: "c2",
        name: "Read",
        status: "completed",
        args: { path: "/tmp/b.ts" },
        at: "2026-07-24T00:00:03.000Z",
      },
      {
        type: "assistant",
        text: "Both files are in.",
        at: "2026-07-24T00:00:04.000Z",
      },
    ];
    ({ container, root } = mountThread("conv-1"));

    const groups = container!.querySelectorAll('[data-event="tool_use_group"]');
    expect(groups).toHaveLength(1);
    const group = groups[0] as HTMLDetailsElement;
    expect(group.open).toBe(false);
    expect(group.getAttribute("data-tool-count")).toBe("2");
    expect(group.getAttribute("data-status")).toBe("completed");
    expect(group.querySelector("summary")!.textContent).toContain("Tool use");
    expect(group.querySelector("summary")!.textContent).toContain("2");
    expect(group.querySelector("summary")!.textContent).toContain("Read");
    expect(group.querySelector("summary")!.textContent).toContain("b.ts");

    const thinking = container!.querySelector('[data-event="thinking"]');
    expect(thinking).toBeTruthy();
    expect(thinking!.closest('[data-event="tool_use_group"]')).toBeNull();

    const assistant = container!.querySelector('[data-event="assistant"]');
    expect(assistant).toBeTruthy();
    expect(assistant!.textContent).toContain("Both files are in.");

    act(() => {
      (group.querySelector("summary") as HTMLElement).click();
    });
    expect(group.open).toBe(true);
    expect(group.querySelector("[data-call-id='c1']")).toBeTruthy();
    expect(group.querySelector("[data-call-id='c2']")).toBeTruthy();
  });

  it("keeps the group collapsed and updates the live hint as tools progress", () => {
    transcriptState.events = [
      { type: "prompt", text: "Run tools", at: "2026-07-24T00:00:00.000Z" },
      {
        type: "tool_call",
        callId: "c1",
        name: "Read",
        status: "completed",
        args: { path: "/tmp/a.ts" },
        at: "2026-07-24T00:00:01.000Z",
      },
      {
        type: "tool_call",
        callId: "c2",
        name: "Grep",
        status: "running",
        args: { pattern: "foo", glob: "*.ts" },
        at: "2026-07-24T00:00:02.000Z",
      },
    ];
    ({ container, root } = mountThread("conv-1"));

    const group = container!.querySelector(
      '[data-event="tool_use_group"]',
    ) as HTMLDetailsElement;
    expect(group.open).toBe(false);
    expect(group.getAttribute("data-status")).toBe("running");
    const summary = () => group.querySelector("summary")!.textContent ?? "";
    expect(summary()).toContain("Grep");
    expect(summary()).toContain("foo in *.ts");

    transcriptState.events = [
      ...transcriptState.events.slice(0, 2),
      {
        type: "tool_call",
        callId: "c2",
        name: "Grep",
        status: "completed",
        args: { pattern: "foo", glob: "*.ts" },
        at: "2026-07-24T00:00:02.000Z",
      },
      {
        type: "tool_call",
        callId: "c3",
        name: "Shell",
        status: "running",
        args: { command: "npm test" },
        at: "2026-07-24T00:00:03.000Z",
      },
    ];
    renderThread(root!, "conv-1");

    expect(group.open).toBe(false);
    expect(group.getAttribute("data-status")).toBe("running");
    expect(summary()).toContain("Shell");
    expect(summary()).toContain("npm test");
    expect(summary()).not.toContain("Grep");

    transcriptState.events = transcriptState.events.map((event) =>
      event.type === "tool_call" && event.callId === "c3"
        ? { ...event, status: "completed" as const }
        : event,
    );
    renderThread(root!, "conv-1");

    expect(group.open).toBe(false);
    expect(group.getAttribute("data-status")).toBe("completed");
    expect(summary()).toContain("Shell");
    expect(summary()).toContain("npm test");
  });

  it("auto-expands the group and errored tool row while siblings stay collapsed", () => {
    transcriptState.events = [
      { type: "prompt", text: "Run tools", at: "2026-07-24T00:00:00.000Z" },
      {
        type: "tool_call",
        callId: "c1",
        name: "Read",
        status: "completed",
        args: { path: "/tmp/a.ts" },
        result: "file contents",
        at: "2026-07-24T00:00:01.000Z",
      },
      {
        type: "tool_call",
        callId: "c2",
        name: "Shell",
        status: "error",
        args: { command: "npm test" },
        result: "Command failed with exit code 1",
        at: "2026-07-24T00:00:02.000Z",
      },
      {
        type: "tool_call",
        callId: "c3",
        name: "Grep",
        status: "completed",
        args: { pattern: "foo" },
        result: "no matches",
        at: "2026-07-24T00:00:03.000Z",
      },
    ];
    ({ container, root } = mountThread("conv-1"));

    const group = container!.querySelector(
      '[data-event="tool_use_group"]',
    ) as HTMLDetailsElement;
    expect(group.open).toBe(true);
    expect(group.getAttribute("data-status")).toBe("error");
    expect(group.querySelector("summary")!.textContent).toContain("error");

    const errored = group.querySelector(
      "[data-call-id='c2']",
    ) as HTMLDetailsElement;
    expect(errored.open).toBe(true);
    expect(group.textContent).toContain("Command failed with exit code 1");

    const completed = group.querySelector(
      "[data-call-id='c1']",
    ) as HTMLDetailsElement;
    expect(completed.open).toBe(false);
    expect(group.querySelector("[data-call-id='c1'] summary")!.textContent).not.toContain(
      "file contents",
    );

    const sibling = group.querySelector(
      "[data-call-id='c3']",
    ) as HTMLDetailsElement;
    expect(sibling.open).toBe(false);
    expect(group.querySelector("[data-call-id='c3'] summary")!.textContent).not.toContain(
      "no matches",
    );
  });
});
