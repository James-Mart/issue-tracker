// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChannelSessionListItem, IssueRecord, IssuesResponse } from "@server/schemas";
import { implementingResumePrompt } from "@server/services/implementing-launch";
import { issuesKeys } from "../api/keys";
import type { FlowItem } from "../lib/flow";
import { channelSessionListItem } from "../test/channel-session-list-item";
import { FlowRowActions } from "./flow-row-actions";

const sendMutate = vi.hoisted(() => vi.fn());
const parkMutate = vi.hoisted(() => vi.fn());
const resumeParkedMutate = vi.hoisted(() => vi.fn());
const sessionState = vi.hoisted(() => ({
  sessions: [] as ChannelSessionListItem[],
  isLoading: false,
}));

vi.mock("@/features/agents/api/mutations", () => ({
  useCancelConversationRun: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useSendConversationMessage: () => ({
    mutate: sendMutate,
    isPending: false,
  }),
}));

vi.mock("../api/queries", () => ({
  useChannelSessionsQuery: () => ({
    data: sessionState.sessions,
    isLoading: sessionState.isLoading,
  }),
}));

vi.mock("../api/mutations", () => ({
  useEnqueueWorkRoot: () => ({ mutate: vi.fn(), isPending: false }),
  useDequeueWorkRoot: () => ({ mutate: vi.fn(), isPending: false }),
  useParkWorkRoot: () => ({ mutate: parkMutate, isPending: false }),
  useResumeParkedWorkRoot: () => ({
    mutate: resumeParkedMutate,
    isPending: false,
  }),
  useReorderQueuePosition: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateChannelSession: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateIssue: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("../hooks/use-confirm-channel-live-run", () => ({
  useConfirmChannelLiveRun: () => ({
    confirmIfLiveRun: (action: () => void) => action(),
    awaitingConfirm: false,
    confirming: false,
    dialog: null,
  }),
}));

const t0 = "2026-07-01T00:00:00.000Z";

function epic(id: string): Extract<IssueRecord, { kind: "epic" }> {
  return {
    id,
    kind: "epic",
    title: "Ship it",
    partOf: "project-a",
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    needsAttention: false,
    attentionReason: null,
    blockedBy: [],
    archived: false,
  };
}

function mount(node: ReactNode): {
  container: HTMLDivElement;
  root: Root;
  client: QueryClient;
} {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter>{node}</MemoryRouter>
      </QueryClientProvider>,
    );
  });
  return { container, root, client };
}

afterEach(() => {
  document.body.innerHTML = "";
  sendMutate.mockReset();
  parkMutate.mockReset();
  resumeParkedMutate.mockReset();
  sessionState.sessions = [];
  sessionState.isLoading = false;
});

describe("queue resume", () => {
  it("sends the resume prompt into a paused root's session", () => {
    sessionState.sessions = [channelSessionListItem({ id: "sess-1" })];
    sendMutate.mockImplementation(
      (_body: unknown, options: { onSuccess?: (result: { runId?: string }) => void }) => {
        options.onSuccess?.({ runId: "run-1" });
      },
    );
    const issue = epic("ship-epic");
    const item: FlowItem = {
      issue,
      state: { blocked: false, implementingOpen: true },
      queueStage: "paused",
    };
    const { container, client } = mount(<FlowRowActions item={item} />);
    client.setQueryData(issuesKeys.list(), {
      issues: [issue],
      problems: [],
      derived: {
        "ship-epic": { blocked: false, implementingOpen: true },
      },
    } as IssuesResponse);

    act(() => {
      (
        container.querySelector(
          '[data-testid="flow-row-resume"]',
        ) as HTMLButtonElement
      ).click();
    });

    expect(sendMutate).toHaveBeenCalledWith(
      {
        id: "sess-1",
        body: { prompt: implementingResumePrompt() },
      },
      expect.any(Object),
    );
    expect(
      client.getQueryData<IssuesResponse>(issuesKeys.list())?.derived["ship-epic"]
        .implementingLive,
    ).toBe(true);
    expect(container.querySelector('[data-testid="flow-row-park"]')).toBeTruthy();
  });
});
