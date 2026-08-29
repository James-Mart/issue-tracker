// @vitest-environment happy-dom
import { act, useEffect, useRef, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TranscriptEvent } from "@server/schemas";
import { agentsKeys } from "../api/keys";
import { useUploadConversationAttachment } from "../api/mutations";
import { ConversationThread } from "./conversation-thread";

const uploadConversationAttachment = vi.hoisted(() => vi.fn());
const listConversationAttachments = vi.hoisted(() => vi.fn());

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return {
    ...actual,
    uploadConversationAttachment: (...args: unknown[]) =>
      uploadConversationAttachment(...args),
    listConversationAttachments: (...args: unknown[]) =>
      listConversationAttachments(...args),
  };
});

const transcriptState = vi.hoisted(() => ({
  events: [] as TranscriptEvent[],
}));

vi.mock("../api/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/queries")>();
  return {
    ...actual,
    useConversationsQuery: () => ({
      data: [
        {
          id: "conv-1",
          title: "Test thread",
          model: "composer-2.5-fast",
        },
      ],
    }),
  };
});

vi.mock("../api/mutations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/mutations")>();
  return {
    ...actual,
    useUpdateConversationPending: () => ({
      mutate: vi.fn(),
      isPending: false,
    }),
    useClearConversationPending: () => ({
      mutate: vi.fn(),
      isPending: false,
    }),
    useSendConversationMessage: () => ({
      mutate: vi.fn(),
      isPending: false,
    }),
  };
});

vi.mock("../hooks/use-conversation-events", () => ({
  useConversationEvents: () => ({
    events: transcriptState.events,
    ready: true,
    streamRunActive: false,
    runResyncKey: 0,
    pendingText: undefined,
    historyFailed: false,
    refetchHistory: vi.fn(),
    isRefetchingHistory: false,
    historyError: null,
  }),
}));

vi.mock("../hooks/use-conversation-run-active", () => ({
  useConversationRunActive: () => ({ runActive: false }),
}));

vi.mock("./composer", () => ({
  Composer: () => <div data-testid="conversation-composer" />,
}));

function testQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function UploadOnce({
  conversationId,
  file,
  onUploaded,
}: {
  conversationId: string;
  file: File;
  onUploaded: () => void;
}) {
  const upload = useUploadConversationAttachment(conversationId);
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void upload.mutateAsync(file).then(onUploaded);
  }, [conversationId, file, onUploaded, upload]);
  return null;
}

function mountWithClient(
  client: QueryClient,
  ui: ReactNode,
): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
    );
  });
  return { container, root };
}

describe("Conversation attachment cache sync", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    container = undefined;
    root = undefined;
    transcriptState.events = [];
    uploadConversationAttachment.mockReset();
    listConversationAttachments.mockReset();
  });

  it("renders a prompt attachment row after upload updates the empty attachments cache", async () => {
    const uploaded = {
      name: "shot.png",
      size: 2048,
      mimeType: "image/png",
    };
    uploadConversationAttachment.mockResolvedValue(uploaded);
    listConversationAttachments.mockResolvedValue([]);

    const client = testQueryClient();
    client.setQueryData(agentsKeys.attachments("conv-1"), []);

    const file = new File(["pixels"], "shot.png", { type: "image/png" });
    let uploadDone = false;

    ({ container, root } = mountWithClient(
      client,
      <UploadOnce
        conversationId="conv-1"
        file={file}
        onUploaded={() => {
          uploadDone = true;
        }}
      />,
    ));

    await act(async () => {
      while (!uploadDone) {
        await Promise.resolve();
      }
    });

    transcriptState.events = [
      {
        type: "prompt",
        text: "See this",
        attachments: ["shot.png"],
        at: "2026-07-24T00:00:00.000Z",
      },
    ];

    act(() => {
      root!.render(
        <QueryClientProvider client={client}>
          <ConversationThread conversationId="conv-1" />
        </QueryClientProvider>,
      );
    });

    expect(
      container!.querySelector('[data-prompt-attachment-missing="shot.png"]'),
    ).toBeNull();
    expect(
      container!.querySelector('[data-prompt-attachment-image="shot.png"]'),
    ).toBeTruthy();
    expect(
      container!.querySelector(
        'img[src="/api/conversations/conv-1/attachments/shot.png"]',
      ),
    ).toBeTruthy();
  });

  it("renders a file download row after upload updates the empty attachments cache", async () => {
    const uploaded = {
      name: "notes.txt",
      size: 4096,
      mimeType: "text/plain",
    };
    uploadConversationAttachment.mockResolvedValue(uploaded);
    listConversationAttachments.mockResolvedValue([]);

    const client = testQueryClient();
    client.setQueryData(agentsKeys.attachments("conv-1"), []);

    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    let uploadDone = false;

    ({ container, root } = mountWithClient(
      client,
      <UploadOnce
        conversationId="conv-1"
        file={file}
        onUploaded={() => {
          uploadDone = true;
        }}
      />,
    ));

    await act(async () => {
      while (!uploadDone) {
        await Promise.resolve();
      }
    });

    transcriptState.events = [
      {
        type: "prompt",
        text: "Review this log",
        attachments: ["notes.txt"],
        at: "2026-07-24T00:00:00.000Z",
      },
    ];

    act(() => {
      root!.render(
        <QueryClientProvider client={client}>
          <ConversationThread conversationId="conv-1" />
        </QueryClientProvider>,
      );
    });

    expect(
      container!.querySelector('[data-prompt-attachment-missing="notes.txt"]'),
    ).toBeNull();
    expect(
      container!.querySelector('[data-prompt-attachment-file="notes.txt"]'),
    ).toBeTruthy();
  });
});
