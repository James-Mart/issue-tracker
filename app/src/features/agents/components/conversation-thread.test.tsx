// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TranscriptEvent } from "@server/schemas";
import { isScrollPinned } from "@/features/issues/components/chat/message-scroller";
import { ConversationThread } from "./conversation-thread";

const initialEvents: TranscriptEvent[] = [
  { type: "prompt", text: "First turn", at: "2026-07-24T00:00:00.000Z" },
  {
    type: "assistant",
    text: "First reply with enough body to exceed one viewport.",
    at: "2026-07-24T00:00:01.000Z",
  },
  { type: "prompt", text: "Second turn", at: "2026-07-24T00:00:02.000Z" },
  {
    type: "assistant",
    text: "Latest reply — opening the thread should land here.",
    at: "2026-07-24T00:00:03.000Z",
  },
];

const transcriptState: { events: TranscriptEvent[] } = {
  events: [...initialEvents],
};

vi.mock("../api/queries", () => ({
  useConversationsQuery: () => ({
    data: [
      { id: "conv-1", title: "Test thread", model: "composer-2.5-fast" },
      { id: "conv-2", title: "Other thread", model: "composer-2.5-fast" },
    ],
  }),
}));

vi.mock("../hooks/use-conversation-events", () => ({
  useConversationEvents: () => ({
    events: transcriptState.events,
    ready: true,
    streamRunActive: false,
    runResyncKey: 0,
  }),
}));

vi.mock("../hooks/use-conversation-run-active", () => ({
  useConversationRunActive: () => ({ runActive: false }),
}));

vi.mock("./composer", () => ({
  Composer: () => null,
}));

function mountThread(conversationId: string): {
  container: HTMLDivElement;
  root: Root;
} {
  const container = document.createElement("div");
  container.style.height = "240px";
  container.style.width = "480px";
  container.style.display = "flex";
  container.style.flexDirection = "column";
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<ConversationThread conversationId={conversationId} />);
  });
  return { container, root };
}

function threadScroller(container: ParentNode): HTMLDivElement {
  const scroller = container.querySelector('[data-pinned="true"]');
  expect(scroller).toBeTruthy();
  return scroller as HTMLDivElement;
}

function mockOverflow(scroller: HTMLDivElement) {
  Object.defineProperty(scroller, "scrollHeight", {
    configurable: true,
    value: 1200,
  });
  Object.defineProperty(scroller, "clientHeight", {
    configurable: true,
    value: 240,
  });
  scroller.scrollTop = 0;
}

describe("ConversationThread scroller", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    container = undefined;
    root = undefined;
    transcriptState.events = [...initialEvents];
  });

  it("positions at the bottom when a conversation opens", () => {
    ({ container, root } = mountThread("conv-1"));
    act(() => root!.unmount());

    root = createRoot(container!);
    act(() => {
      root!.render(<ConversationThread conversationId="conv-2" />);
    });

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

    act(() => {
      root!.render(<ConversationThread conversationId="conv-2" />);
    });

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

    act(() => {
      root!.render(<ConversationThread conversationId="conv-1" />);
    });

    expect(scroller.scrollTop).toBe(1200);
    expect(isScrollPinned(scroller)).toBe(true);
  });
});
