// @vitest-environment happy-dom
import {
  initialEvents,
  mockOverflow,
  mountThread,
  renderThread,
  resetThreadMocks,
  threadScroller,
  transcriptState,
} from "./conversation-thread.test-helpers";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { TranscriptEvent } from "@server/schemas";
import { isScrollPinned } from "@/components/ui/message-scroller";

describe("ConversationThread scroller", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    container = undefined;
    root = undefined;
    resetThreadMocks();
  });

  it("positions at the bottom when a conversation opens", () => {
    ({ container, root } = mountThread("conv-1"));
    act(() => root!.unmount());

    root = createRoot(container!);
    renderThread(root, "conv-2");

    const scroller = threadScroller(container!);
    expect(scroller.getAttribute("role")).toBe("log");
    mockOverflow(scroller);

    transcriptState.events = [
      ...initialEvents,
      {
        type: "assistant",
        text: "Newest message on open",
        at: "2026-07-24T00:00:04.000Z",
      },
    ];

    renderThread(root, "conv-2");

    expect(scroller.scrollTop).toBe(1200);
    expect(isScrollPinned(scroller)).toBe(true);
  });

  it("follows in-place assistant streaming while pinned", () => {
    ({ container, root } = mountThread("conv-1"));
    const scroller = threadScroller(container!);
    mockOverflow(scroller);

    const last = transcriptState.events.at(-1);
    expect(last?.type).toBe("assistant");
    transcriptState.events = [
      ...transcriptState.events.slice(0, -1),
      {
        type: "assistant",
        text: `${(last as Extract<TranscriptEvent, { type: "assistant" }>).text} streaming tokens`,
        at: "2026-07-24T00:00:04.000Z",
      },
    ];
    expect(transcriptState.events.length).toBe(initialEvents.length);

    renderThread(root!, "conv-1");

    expect(scroller.scrollTop).toBe(1200);
    expect(isScrollPinned(scroller)).toBe(true);
  });
});
