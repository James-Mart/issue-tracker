import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, vi } from "vitest";
import type { TranscriptEvent } from "@server/schemas";
import { ConversationThread } from "./conversation-thread";

const initialEvents: TranscriptEvent[] = [
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
    ready: true,
    historyFailed: false,
    historyErrorMessage: undefined as string | undefined,
  },
  forkMutate: vi.fn(),
  navigate: vi.fn(),
}));

export const transcriptState = mocks.transcriptState;
export const threadUi = mocks.threadUi;
export const forkMutate = mocks.forkMutate;
export const navigate = mocks.navigate;

mocks.transcriptState.events = [...initialEvents];

vi.mock("../api/queries", () => ({
  useConversationsQuery: () => ({
    data: [{ id: "conv-1", title: "Test thread", model: "composer-2.5-fast" }],
  }),
  useConversationAttachmentsQuery: () => ({ data: [], isLoading: false }),
}));

vi.mock("../api/mutations", () => ({
  useUpdateConversationPending: () => ({ mutate: vi.fn(), isPending: false }),
  useClearConversationPending: () => ({ mutate: vi.fn(), isPending: false }),
  useSendConversationMessage: () => ({ mutate: vi.fn(), isPending: false }),
  useForkConversation: () => ({
    mutate: forkMutate,
    isPending: false,
  }),
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useNavigate: () => navigate,
  };
});

vi.mock("../hooks/use-conversation-events", () => ({
  useConversationEvents: () => ({
    events: transcriptState.events,
    ready: threadUi.ready,
    streamRunActive: threadUi.runActive,
    runResyncKey: 0,
    pendingText: threadUi.pendingText,
    steeringText: null,
    pendingSteerFallback: false,
    historyFailed: threadUi.historyFailed,
    refetchHistory: vi.fn(),
    isRefetchingHistory: false,
    historyError: threadUi.historyErrorMessage
      ? new Error(threadUi.historyErrorMessage)
      : null,
    hasOlder: false,
    olderStatus: "idle",
    prependedRows: 0,
    loadOlder: vi.fn(),
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

const mountedRoots: Root[] = [];

export function mountThread(conversationId: string): HTMLDivElement {
  const container = document.createElement("div");
  container.style.height = "240px";
  container.style.width = "480px";
  container.style.display = "flex";
  container.style.flexDirection = "column";
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push(root);
  act(() => {
    root.render(<ConversationThread conversationId={conversationId} />);
  });
  return container;
}

afterEach(() => {
  for (const root of mountedRoots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  resetThreadMocks();
});

function resetThreadMocks() {
  transcriptState.events = [...initialEvents];
  threadUi.pendingText = undefined;
  threadUi.runActive = false;
  threadUi.ready = true;
  threadUi.historyFailed = false;
  threadUi.historyErrorMessage = undefined;
  forkMutate.mockReset();
  navigate.mockClear();
}
