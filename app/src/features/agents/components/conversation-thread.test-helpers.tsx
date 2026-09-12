import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { expect, vi } from "vitest";
import type { TranscriptEvent } from "@server/schemas";
import { ConversationThread } from "./conversation-thread";

export const initialEvents: TranscriptEvent[] = [
  {
    type: "prompt",
    text: "First turn",
    at: "2026-07-24T00:00:00.000Z",
    seq: 1,
  },
  {
    type: "assistant",
    text: "First reply with enough body to exceed one viewport.",
    at: "2026-07-24T00:00:01.000Z",
    seq: 2,
  },
  {
    type: "prompt",
    text: "Second turn",
    at: "2026-07-24T00:00:02.000Z",
    seq: 3,
  },
  {
    type: "assistant",
    text: "Latest reply — opening the thread should land here.",
    at: "2026-07-24T00:00:03.000Z",
    seq: 4,
  },
];

const mocks = vi.hoisted(() => ({
  transcriptState: { events: [] as TranscriptEvent[] },
  threadUi: {
    pendingText: undefined as string | null | undefined,
    runActive: false,
    metaPending: undefined as { text: string; at: string } | undefined,
    readOnly: false,
    forkedFrom: undefined as string | undefined,
    ready: true,
    historyFailed: false,
    historyErrorMessage: undefined as string | undefined,
    isRefetchingHistory: false,
  },
  attachmentStore: {
    attachments: [] as Array<{ name: string; size: number; mimeType: string }>,
    isLoading: false,
  },
  refetchHistory: vi.fn(),
  updatePendingMutate: vi.fn(),
  clearPendingMutate: vi.fn(),
  sendMutate: vi.fn(),
  forkMutate: vi.fn(),
  setSelectedConversationId: vi.fn(),
}));

export const transcriptState = mocks.transcriptState;
export const threadUi = mocks.threadUi;
export const attachmentStore = mocks.attachmentStore;
export const refetchHistory = mocks.refetchHistory;
export const updatePendingMutate = mocks.updatePendingMutate;
export const clearPendingMutate = mocks.clearPendingMutate;
export const sendMutate = mocks.sendMutate;
export const forkMutate = mocks.forkMutate;
export const setSelectedConversationId = mocks.setSelectedConversationId;

function eventsWithSeq(events: TranscriptEvent[]): TranscriptEvent[] {
  return events.map((event, index) =>
    event.seq !== undefined ? event : { ...event, seq: index + 1 },
  );
}

mocks.transcriptState.events = [...initialEvents];

vi.mock("../api/queries", () => ({
  useConversationsQuery: () => ({
    data: [
      {
        id: "conv-1",
        title: "Test thread",
        model: "composer-2.5-fast",
        pendingMessage: threadUi.metaPending,
        readOnly: threadUi.readOnly || undefined,
        forkedFrom: threadUi.forkedFrom,
        forkedAtSeq: threadUi.forkedFrom ? 2 : undefined,
      },
      { id: "conv-2", title: "Other thread", model: "composer-2.5-fast" },
      { id: "conv-source", title: "Source thread", model: "composer-2.5-fast" },
    ],
  }),
  useConversationAttachmentsQuery: () => ({
    data: attachmentStore.attachments,
    isLoading: attachmentStore.isLoading,
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
  useForkConversation: () => ({
    mutate: forkMutate,
    isPending: false,
  }),
}));

vi.mock("../store/use-agents-ui-store", () => ({
  useAgentsUiStore: (
    select: (state: {
      setSelectedConversationId: typeof setSelectedConversationId;
    }) => unknown,
  ) => select({ setSelectedConversationId }),
}));

vi.mock("../hooks/use-conversation-events", () => ({
  useConversationEvents: () => ({
    events: eventsWithSeq(transcriptState.events),
    ready: threadUi.ready,
    streamRunActive: threadUi.runActive,
    runResyncKey: 0,
    pendingText: threadUi.pendingText,
    historyFailed: threadUi.historyFailed,
    refetchHistory,
    isRefetchingHistory: threadUi.isRefetchingHistory,
    historyError: threadUi.historyErrorMessage
      ? new Error(threadUi.historyErrorMessage)
      : null,
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

export function renderThread(
  root: Root,
  conversationId: string,
  props?: Omit<ComponentProps<typeof ConversationThread>, "conversationId">,
) {
  act(() => {
    root.render(
      <ConversationThread conversationId={conversationId} {...props} />,
    );
  });
}

export function mountThread(
  conversationId: string,
  options?: { width?: string },
): {
  container: HTMLDivElement;
  root: Root;
} {
  const container = document.createElement("div");
  container.style.height = "240px";
  container.style.width = options?.width ?? "480px";
  container.style.display = "flex";
  container.style.flexDirection = "column";
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<ConversationThread conversationId={conversationId} />);
  });
  return { container, root };
}

export function threadScroller(container: ParentNode): HTMLDivElement {
  const scroller = container.querySelector('[data-pinned="true"]');
  expect(scroller).toBeTruthy();
  return scroller as HTMLDivElement;
}

export function mockOverflow(scroller: HTMLDivElement) {
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

export function resetThreadMocks() {
  transcriptState.events = [...initialEvents];
  threadUi.pendingText = undefined;
  threadUi.runActive = false;
  threadUi.metaPending = undefined;
  threadUi.readOnly = false;
  threadUi.forkedFrom = undefined;
  threadUi.ready = true;
  threadUi.historyFailed = false;
  threadUi.historyErrorMessage = undefined;
  threadUi.isRefetchingHistory = false;
  attachmentStore.attachments = [];
  attachmentStore.isLoading = false;
  updatePendingMutate.mockClear();
  clearPendingMutate.mockClear();
  sendMutate.mockClear();
  forkMutate.mockClear();
  setSelectedConversationId.mockClear();
  refetchHistory.mockClear();
}
