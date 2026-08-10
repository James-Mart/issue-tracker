// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TranscriptEvent } from "@server/schemas";
import { isScrollPinned } from "@/components/ui/message-scroller";
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

const threadUi = vi.hoisted(() => ({
  pendingText: undefined as string | null | undefined,
  runActive: false,
  metaPending: undefined as { text: string; at: string } | undefined,
}));

const updatePendingMutate = vi.hoisted(() => vi.fn());
const clearPendingMutate = vi.hoisted(() => vi.fn());
const sendMutate = vi.hoisted(() => vi.fn());

vi.mock("../api/queries", () => ({
  useConversationsQuery: () => ({
    data: [
      {
        id: "conv-1",
        title: "Test thread",
        model: "composer-2.5-fast",
        pendingMessage: threadUi.metaPending,
      },
      { id: "conv-2", title: "Other thread", model: "composer-2.5-fast" },
    ],
  }),
}));

vi.mock("../api/mutations", () => ({
  useUpdateConversationPending: () => ({
    mutate: updatePendingMutate,
    isPending: false,
  }),
  useClearConversationPending: () => ({
    mutate: clearPendingMutate,
    isPending: false,
  }),
  useSendConversationMessage: () => ({
    mutate: sendMutate,
    isPending: false,
  }),
}));

vi.mock("../hooks/use-conversation-events", () => ({
  useConversationEvents: () => ({
    events: transcriptState.events,
    ready: true,
    streamRunActive: threadUi.runActive,
    runResyncKey: 0,
    pendingText: threadUi.pendingText,
  }),
}));

vi.mock("../hooks/use-conversation-run-active", () => ({
  useConversationRunActive: () => ({ runActive: threadUi.runActive }),
}));

vi.mock("./composer", () => ({
  Composer: ({ model }: { model: string }) => (
    <div data-testid="conversation-composer" data-model={model} />
  ),
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
    threadUi.pendingText = undefined;
    threadUi.runActive = false;
    threadUi.metaPending = undefined;
    updatePendingMutate.mockClear();
    clearPendingMutate.mockClear();
    sendMutate.mockClear();
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

describe("ConversationThread pending message", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    container = undefined;
    root = undefined;
    transcriptState.events = [...initialEvents];
    threadUi.pendingText = undefined;
    threadUi.runActive = false;
    threadUi.metaPending = undefined;
    updatePendingMutate.mockClear();
    clearPendingMutate.mockClear();
    sendMutate.mockClear();
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

describe("ConversationThread anchored meta", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    container = undefined;
    root = undefined;
    transcriptState.events = [...initialEvents];
  });

  it("mounts the composer from meta when the id is absent from the Agents roster", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <ConversationThread
          conversationId="anchored-1"
          meta={{ title: "Plan capture", model: "composer-2.5" }}
        />,
      );
    });
    const composer = container.querySelector(
      '[data-testid="conversation-composer"]',
    );
    expect(composer?.getAttribute("data-model")).toBe("composer-2.5");
    expect(container.textContent).toContain("Plan capture");
  });

  it("omits the composer when hideComposer is set for archived history", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <ConversationThread
          conversationId="anchored-archived"
          meta={{ title: "Old plan", model: "composer-2.5" }}
          hideComposer
        />,
      );
    });
    expect(
      container.querySelector('[data-testid="conversation-composer"]'),
    ).toBeNull();
    expect(container.textContent).toContain("Old plan");
  });
});
