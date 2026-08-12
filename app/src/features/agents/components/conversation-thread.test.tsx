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

describe("ConversationThread Tool use groups", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    container = undefined;
    root = undefined;
    transcriptState.events = [...initialEvents];
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
    act(() => {
      root!.render(<ConversationThread conversationId="conv-1" />);
    });

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
    act(() => {
      root!.render(<ConversationThread conversationId="conv-1" />);
    });

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

