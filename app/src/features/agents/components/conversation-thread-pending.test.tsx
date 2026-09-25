// @vitest-environment happy-dom
import { act } from "react";
import { type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearPendingMutate,
  mountThread,
  resetThreadMocks,
  sendMutate,
  threadUi,
  transcriptState,
  updatePendingMutate,
} from "./conversation-thread.test-helpers";

describe("ConversationThread pending message", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    container = undefined;
    root = undefined;
    resetThreadMocks();
  });

  it("renders a pending message row from conversation meta", () => {
    threadUi.metaPending = {
      text: "follow up after this run",
      at: "2026-07-24T00:00:05.000Z",
    };
    threadUi.runActive = true;
    ({ container, root } = mountThread("conv-1"));

    const row = container!.querySelector('[data-testid="pending-message-row"]');
    expect(row).toBeTruthy();
    expect(row!.textContent).toContain("follow up after this run");
    expect(row!.getAttribute("data-run-active")).toBe("true");
    expect(row!.textContent).toContain("Queued");
  });

  it("edits the pending message in place", () => {
    threadUi.pendingText = "edit me";
    threadUi.runActive = true;
    ({ container, root } = mountThread("conv-1"));

    act(() => {
      (
        container!.querySelector(
          '[data-testid="pending-message-row"] button[type="button"]',
        ) as HTMLButtonElement
      ).click();
    });

    const input = container!.querySelector(
      'input[aria-label="Edit queued message"]',
    ) as HTMLInputElement;
    expect(input).toBeTruthy();

    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    act(() => {
      nativeInputValueSetter.call(input, "edited text");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      input.form!.requestSubmit();
    });

    expect(updatePendingMutate).toHaveBeenCalledWith(
      { id: "conv-1", text: "edited text" },
      expect.any(Object),
    );
  });

  it("removes the pending message row", () => {
    threadUi.pendingText = "remove me";
    ({ container, root } = mountThread("conv-1"));

    act(() => {
      (
        container!.querySelector(
          'button[aria-label="Remove queued message"]',
        ) as HTMLButtonElement
      ).click();
    });

    expect(clearPendingMutate).toHaveBeenCalledWith("conv-1");
  });

  it("shows not-sent state when pending coexists with no active run", () => {
    threadUi.pendingText = "never sent";
    threadUi.runActive = false;
    ({ container, root } = mountThread("conv-1"));

    const row = container!.querySelector('[data-testid="pending-message-row"]');
    expect(row!.textContent).toContain("Not sent");
    expect(row!.textContent).toContain(
      "The run ended before this message could send.",
    );
    expect(
      container!.querySelector('[data-testid="pending-send-now"]'),
    ).toBeTruthy();
  });

  it("renders a steer fallback with edit and remove", () => {
    threadUi.pendingText = "queue instead";
    threadUi.pendingSteerFallback = true;
    threadUi.runActive = true;
    ({ container, root } = mountThread("conv-1"));

    const row = container!.querySelector('[data-testid="pending-message-row"]');
    expect(row!.textContent).toContain("Queued");
    expect(row!.textContent).toContain("queue instead");
    expect(row!.textContent).toContain(
      "Could not be delivered mid-run. Will send after the run.",
    );
    expect(
      container!.querySelector('[data-testid="steering-delivering"]'),
    ).toBeNull();

    act(() => {
      (
        container!.querySelector(
          '[data-testid="pending-message-row"] button[type="button"]',
        ) as HTMLButtonElement
      ).click();
    });
    expect(
      container!.querySelector('input[aria-label="Edit queued message"]'),
    ).toBeTruthy();

    act(() => {
      (
        container!.querySelector(
          'button[aria-label="Remove queued message"]',
        ) as HTMLButtonElement
      ).click();
    });
    expect(clearPendingMutate).toHaveBeenCalledWith("conv-1");
  });

  it("shows Delivering for a steering frame and replaces it with the prompt", () => {
    threadUi.steeringText = "Focus on v0.9";
    threadUi.runActive = true;
    ({ container, root } = mountThread("conv-1"));

    const delivering = container!.querySelector(
      '[data-testid="steering-delivering"]',
    );
    expect(delivering!.textContent).toContain("Delivering…");
    expect(delivering!.textContent).toContain("Focus on v0.9");

    act(() => {
      root!.unmount();
    });
    container!.remove();

    threadUi.steeringText = null;
    transcriptState.events = [
      ...transcriptState.events,
      {
        type: "prompt",
        text: "Focus on v0.9",
        at: "2026-07-24T00:00:04.000Z",
        seq: 5,
      },
    ];
    ({ container, root } = mountThread("conv-1"));

    expect(
      container!.querySelector('[data-testid="steering-delivering"]'),
    ).toBeNull();
    const prompts = [
      ...container!.querySelectorAll('[data-event="prompt"]'),
    ].map((node) => node.textContent);
    expect(prompts.some((text) => text?.includes("Focus on v0.9"))).toBe(true);
  });

  it("sends the pending message now and clears via the ordinary send path", () => {
    threadUi.pendingText = "send when idle";
    threadUi.runActive = false;
    ({ container, root } = mountThread("conv-1"));

    act(() => {
      (
        container!.querySelector(
          '[data-testid="pending-send-now"]',
        ) as HTMLButtonElement
      ).click();
    });

    expect(sendMutate).toHaveBeenCalledWith({
      id: "conv-1",
      body: { prompt: "send when idle", model: "composer-2.5-fast" },
    });
  });
});
