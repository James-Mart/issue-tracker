// @vitest-environment happy-dom
import {
  mountThread,
  refetchHistory,
  resetThreadMocks,
  threadUi,
  transcriptState,
} from "./conversation-thread.test-helpers";
import { act } from "react";
import { type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

describe("ConversationThread transcript load failure", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    container = undefined;
    root = undefined;
    resetThreadMocks();
  });

  it("shows retry rather than skeletons over painted events when a seeded refetch fails", () => {
    threadUi.ready = true;
    threadUi.historyFailed = true;
    ({ container, root } = mountThread("conv-1"));

    expect(container!.querySelector('[aria-busy="true"]')).toBeNull();
    expect(
      container!.querySelector('[data-testid="transcript-retry"]'),
    ).toBeTruthy();
    expect(container!.textContent).not.toContain("First turn");
  });

  it("shows failed/retry UI instead of loading skeletons when historyFailed", () => {
    threadUi.ready = false;
    threadUi.historyFailed = true;
    threadUi.historyErrorMessage = "Request timed out";
    ({ container, root } = mountThread("conv-1"));

    expect(container!.querySelector('[aria-busy="true"]')).toBeNull();
    expect(
      container!.querySelector('[data-testid="transcript-retry"]'),
    ).toBeTruthy();
    expect(container!.textContent).toContain("Could not load the transcript.");
    expect(container!.textContent).toContain("Request timed out");
  });

  it("keeps the loading skeleton while pending and not failed", () => {
    threadUi.ready = false;
    threadUi.historyFailed = false;
    ({ container, root } = mountThread("conv-1"));

    expect(container!.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(
      container!.querySelector('[data-testid="transcript-retry"]'),
    ).toBeNull();
  });

  it("calls refetchHistory when retry is activated", () => {
    threadUi.ready = false;
    threadUi.historyFailed = true;
    ({ container, root } = mountThread("conv-1"));

    act(() => {
      (
        container!.querySelector(
          '[data-testid="transcript-retry"]',
        ) as HTMLButtonElement
      ).click();
    });

    expect(refetchHistory).toHaveBeenCalledTimes(1);
  });

  it("disables retry while a refetch is in flight", () => {
    threadUi.ready = false;
    threadUi.historyFailed = true;
    threadUi.isRefetchingHistory = true;
    ({ container, root } = mountThread("conv-1"));

    expect(
      (
        container!.querySelector(
          '[data-testid="transcript-retry"]',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("keeps inline error transcript events as error cards, not the failed state", () => {
    threadUi.ready = true;
    threadUi.historyFailed = false;
    transcriptState.events = [
      {
        type: "error",
        message: "Agent stream failed",
        at: "2026-07-24T00:00:00.000Z",
      },
    ];
    ({ container, root } = mountThread("conv-1"));

    expect(
      container!.querySelector('[data-testid="transcript-retry"]'),
    ).toBeNull();
    expect(container!.querySelector('[data-event="error"]')).toBeTruthy();
    expect(container!.textContent).toContain("Agent stream failed");
    expect(container!.textContent).toContain("Send failed");
  });

  it("shows the empty state after a successful load with no events", () => {
    threadUi.ready = true;
    threadUi.historyFailed = false;
    transcriptState.events = [];
    ({ container, root } = mountThread("conv-1"));

    expect(container!.textContent).toContain("No transcript yet.");
    expect(
      container!.querySelector('[data-testid="transcript-retry"]'),
    ).toBeNull();
    expect(container!.querySelector('[aria-busy="true"]')).toBeNull();
  });
});
