// @vitest-environment happy-dom
import {
  loadOlder,
  mountThread,
  resetThreadMocks,
  threadUi,
} from "./conversation-thread.test-helpers";
import { act } from "react";
import { type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

describe("ConversationThread older events", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    container = undefined;
    root = undefined;
    resetThreadMocks();
  });

  it("asks for the older page while the reader is at the top and older events remain", () => {
    threadUi.hasOlder = true;
    ({ container, root } = mountThread("conv-1"));

    expect(loadOlder).toHaveBeenCalled();
    const slot = container!.querySelector('[data-testid="older-events-idle"]');
    expect(slot?.nextElementSibling?.textContent).toContain("First turn");
  });

  it("does not ask or hold a top slot when no older events remain", () => {
    ({ container, root } = mountThread("conv-1"));

    expect(loadOlder).not.toHaveBeenCalled();
    expect(
      container!.querySelector('[data-testid^="older-events-"]'),
    ).toBeNull();
  });

  it("shows a loading row above the events while an older page is in flight", () => {
    threadUi.hasOlder = true;
    threadUi.olderStatus = "loading";
    ({ container, root } = mountThread("conv-1"));

    const row = container!.querySelector('[data-testid="older-events-loading"]');
    expect(row?.textContent).toContain("Loading earlier events");
    expect(row?.nextElementSibling?.textContent).toContain("First turn");
    expect(loadOlder).not.toHaveBeenCalled();
  });

  it("keeps loaded events under an inline retry row when the older page fails", () => {
    threadUi.hasOlder = true;
    threadUi.olderStatus = "error";
    ({ container, root } = mountThread("conv-1"));

    const row = container!.querySelector('[data-testid="older-events-failed"]');
    expect(row?.textContent).toContain("Couldn't load earlier events.");
    expect(container!.textContent).toContain("First turn");
    expect(container!.textContent).not.toContain("Could not load the transcript.");
    expect(loadOlder).not.toHaveBeenCalled();

    act(() => {
      (
        container!.querySelector(
          '[data-testid="older-events-retry"]',
        ) as HTMLButtonElement
      ).click();
    });

    expect(loadOlder).toHaveBeenCalledTimes(1);
  });
});
