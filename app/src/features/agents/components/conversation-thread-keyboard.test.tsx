// @vitest-environment happy-dom
import { act } from "react";
import { type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { isScrollPinned } from "@/components/ui/message-scroller";
import {
  initialEvents,
  mockOverflow,
  mountThread,
  resetThreadMocks,
  threadScroller,
  transcriptState,
} from "./conversation-thread.test-helpers";

const AMBIENT_INNER_HEIGHT_PX = window.innerHeight;
const LAYOUT_HEIGHT_PX = 800;

function setInnerHeight(px: number) {
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: px,
  });
}

function mockSoftKeyboard() {
  const state = { coveredPx: 0 };
  const listeners = new Set<() => void>();
  setInnerHeight(LAYOUT_HEIGHT_PX);
  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    value: {
      get height() {
        return LAYOUT_HEIGHT_PX - state.coveredPx;
      },
      offsetTop: 0,
      scale: 1,
      addEventListener: (_event: string, cb: () => void) => {
        listeners.add(cb);
      },
      removeEventListener: (_event: string, cb: () => void) => {
        listeners.delete(cb);
      },
    } as unknown as VisualViewport,
  });

  return {
    open(coveredPx: number) {
      state.coveredPx = coveredPx;
      act(() => {
        for (const cb of listeners) cb();
      });
    },
  };
}

describe("ConversationThread keyboard inset", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    container = undefined;
    root = undefined;
    transcriptState.events = [...initialEvents];
    Reflect.deleteProperty(window, "visualViewport");
    setInnerHeight(AMBIENT_INNER_HEIGHT_PX);
  });

  it("shortens the thread by the covered height so the composer stays reachable", () => {
    const keyboard = mockSoftKeyboard();
    ({ container, root } = mountThread("conv-1"));
    const thread = container!.querySelector(
      '[data-testid="conversation-thread"]',
    ) as HTMLDivElement;
    expect(thread.style.paddingBottom).toBe("0px");

    keyboard.open(320);

    expect(thread.style.paddingBottom).toBe("320px");
    expect(
      container!.querySelector('[data-testid="open-thread-chrome"]'),
    ).toBeTruthy();
    expect(
      container!.querySelector('[data-testid="conversation-composer"]'),
    ).toBeTruthy();
  });

  it("re-lands on the latest messages when the keyboard shortens the transcript", () => {
    const keyboard = mockSoftKeyboard();
    ({ container, root } = mountThread("conv-1"));
    const scroller = threadScroller(container!);
    mockOverflow(scroller);
    expect(scroller.scrollTop).toBe(0);

    keyboard.open(320);

    expect(scroller.scrollTop).toBe(1200);
    expect(isScrollPinned(scroller)).toBe(true);
  });
});
