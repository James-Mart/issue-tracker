import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, vi } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import type { ChannelSessionListItem, DerivedState, IssueDetail, IssueRecord } from "@server/schemas";
import { resetCockpitLaunchStore } from "../store/use-cockpit-launch-store";
import { IssueDetailPage } from "./issue-detail-page";
import { TopBar } from "./top-bar";

const holders = vi.hoisted(() => ({
  mutate: vi.fn(),
  sendMessageMutate: vi.fn(),
  hookOnError: undefined as ((err: Error) => void) | undefined,
  mockState: {
    issue: null as IssueDetail | null,
    issues: [] as IssueRecord[],
    derived: {} as Record<string, DerivedState>,
    sessions: [] as ChannelSessionListItem[],
  },
  liveRunConfirm: {
    midRun: false,
    pending: null as null | (() => void | Promise<void>),
  },
}));

export const mutate = holders.mutate;
export const sendMessageMutate = holders.sendMessageMutate;
export const mockState = holders.mockState;
export const liveRunConfirm = holders.liveRunConfirm;

vi.mock("../api/queries", () => ({
  useIssueDetailQuery: () => ({
    data: holders.mockState.issue,
    isLoading: false,
    error: null,
  }),
  useIssuesQuery: () => ({
    data: { issues: holders.mockState.issues, derived: holders.mockState.derived },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    isFetching: false,
  }),
  useProjectWorktreesQuery: () => ({ data: undefined }),
  useChannelSessionsQuery: () => ({
    data: holders.mockState.sessions,
    isLoading: false,
    error: null,
  }),
  useCommentsQuery: () => ({ data: { messages: [] }, isLoading: false }),
  useIssueAgentRunsQuery: () => ({ data: { runs: [] }, isLoading: false }),
  useIssueChangeQuery: () => ({ data: undefined, isLoading: false, error: null }),
}));

vi.mock("@/features/agents/api/queries", () => ({
  useAgentModelsQuery: () => ({
    data: { models: [{ id: "composer-2.5", displayName: "Composer 2.5" }] },
    isLoading: false,
  }),
}));

vi.mock("../api/mutations", () => ({
  useCreateChannelSession: (
    issueId: string,
    channel: string,
    options?: { onError?: (err: Error) => void },
  ) => ({
    mutate: (...args: unknown[]) => {
      holders.hookOnError = options?.onError;
      holders.mutate(issueId, channel, ...args);
    },
    isPending: false,
  }),
  useUpdateIssue: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useCreateIssue: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useUpdateFromMergeBase: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useUploadAttachment: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useDeleteChannelSession: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}));

vi.mock("@/features/agents/api/mutations", () => ({
  useSendConversationMessage: () => ({
    mutate: (...args: unknown[]) => {
      holders.sendMessageMutate(...args);
    },
    isPending: false,
  }),
}));

vi.mock("../hooks/use-confirm-channel-live-run", () => ({
  useConfirmChannelLiveRun: () => ({
    confirmIfLiveRun: (action: () => void) => {
      if (!holders.liveRunConfirm.midRun) {
        action();
        return;
      }
      holders.liveRunConfirm.pending = action;
    },
    awaitingConfirm: holders.liveRunConfirm.pending !== null,
    confirming: false,
    dialog: null,
  }),
}));

vi.mock("../hooks/use-issue-detail-file-upload", () => ({
  useIssueDetailFileUpload: () => ({
    rootProps: {},
  }),
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("./restart-control", () => ({
  RestartControl: () => null,
}));

vi.mock("./backup-chip", () => ({
  BackupChip: () => null,
}));

vi.mock("@/features/agents/components/conversation-thread", () => ({
  ConversationThread: ({ conversationId }: { conversationId: string }) => (
    <div data-testid="conversation-thread" data-conversation-id={conversationId}>
      session thread
    </div>
  ),
  OpenThreadChrome: ({
    title,
    runActive,
  }: {
    title: string;
    runActive: boolean;
  }) => (
    <div data-testid="open-thread-chrome">
      <span>{title}</span>
      <div
        data-testid="thread-status-strip"
        data-run-active={runActive ? "true" : "false"}
      >
        {runActive ? "running" : "idle"} 0 tokens · in 0 · out 0
      </div>
    </div>
  ),
}));

vi.mock("./issue-meta-panel", () => ({ IssueMetaPanel: () => null }));
vi.mock("./attachments-panel", () => ({ IssueAttachmentsSection: () => null }));
vi.mock("./issue-description-field", () => ({ IssueDescriptionField: () => null }));
vi.mock("./comments/comments-section", () => ({ IssueCommentsSection: () => null }));
vi.mock("./epic-story-rail", () => ({ EpicStoryRail: () => null }));
vi.mock("./story-task-rail", () => ({
  StoryTaskRail: () => <div data-testid="story-task-rail">rail</div>,
}));
vi.mock("./delete-partial-plan-control", () => ({ DeletePartialPlanDetailAction: () => null }));
vi.mock("./channel-retro-control", () => ({ ChannelRetroControl: () => null }));
vi.mock("./agent-runs-panel", () => ({ AgentRunsPanel: () => null }));

const t0 = "2026-07-01T00:00:00.000Z";

type RecordOf<K extends IssueRecord["kind"]> = Extract<IssueRecord, { kind: K }>;

export function project(id: string): IssueRecord {
  return {
    id,
    kind: "project",
    title: `Project ${id}`,
    trunk: "main",
    mergePolicy: "manual",
    maxImplementingRuns: 1,
    order: 0,
    createdAt: t0,
    updatedAt: t0,
  };
}

export function epicRecord(id: string, partOf: string, title: string): RecordOf<"epic"> {
  return {
    id,
    kind: "epic",
    title,
    partOf,
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    needsAttention: false,
    attentionReason: null,
    blockedBy: [],
    archived: false,
  };
}

export function ideaRecord(id: string, partOf: string, title: string): RecordOf<"idea"> {
  return {
    id,
    kind: "idea",
    title,
    partOf,
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    archived: false,
  };
}

export function epicDetail(id: string, partOf: string, title: string): IssueDetail {
  return {
    ...epicRecord(id, partOf, title),
    description: "",
    version: "1",
    labels: [],
  };
}

export function ideaDetail(id: string, partOf: string, title: string): IssueDetail {
  return {
    ...ideaRecord(id, partOf, title),
    description: "",
    version: "1",
    labels: [],
    stakeholder: "composer-2.5",
  };
}

export function mountDetail(entry: string): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[entry]}>
        <SidebarProvider>
          <TopBar />
          <Routes>
            <Route
              path="/projects/:projectId/issues/:id"
              element={<IssueDetailPage />}
            />
          </Routes>
        </SidebarProvider>
      </MemoryRouter>,
    );
  });
  return { container, root };
}

export function remount(
  root: Root,
  entry: string,
): void {
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[entry]}>
        <SidebarProvider>
          <TopBar />
          <Routes>
            <Route
              path="/projects/:projectId/issues/:id"
              element={<IssueDetailPage />}
            />
          </Routes>
        </SidebarProvider>
      </MemoryRouter>,
    );
  });
}

export function mutateOptions(): {
  onSuccess?: (result: { id: string }) => void;
  onError?: (err: Error) => void;
} {
  const passed = mutate.mock.calls[0]?.[3] as
    | {
        onSuccess?: (result: { id: string }) => void;
        onError?: (err: Error) => void;
      }
    | undefined;
  return {
    onSuccess: passed?.onSuccess,
    onError: holders.hookOnError,
  };
}

export function sendMessageOptions(): {
  onSuccess?: () => void;
  onError?: (err: Error) => void;
} {
  return sendMessageMutate.mock.calls[0]?.[1] as {
    onSuccess?: () => void;
    onError?: (err: Error) => void;
  };
}

export function storyRecord(id: string, partOf: string, title: string): RecordOf<"story"> {
  return {
    id,
    kind: "story",
    title,
    partOf,
    order: 0,
    branchName: id,
    merged: false,
    reviewedTasks: [],
    createdAt: t0,
    updatedAt: t0,
    needsAttention: false,
    attentionReason: null,
    archived: false,
  };
}

export function storyDetail(id: string, partOf: string, title: string): IssueDetail {
  return {
    ...storyRecord(id, partOf, title),
    description: "",
    version: "1",
    labels: [],
  };
}

export function taskRecord(
  id: string,
  partOf: string,
  status: "todo" | "done" | "in-progress",
): IssueRecord {
  return {
    id,
    kind: "task",
    title: id,
    partOf,
    status,
    commits: [],
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    needsAttention: false,
    attentionReason: null,
    archived: false,
  };
}

export function workLoopControlIndex(container: ParentNode): number {
  const nodes = Array.from(container.querySelectorAll("*"));
  return nodes.findIndex((node) =>
    node.matches('[data-testid="post-rail-work-loop"]'),
  );
}

export function ownFlowIndex(container: ParentNode): number {
  const nodes = Array.from(container.querySelectorAll("*"));
  return nodes.findIndex((node) => node.matches('[data-region="own-flow"]'));
}

export function selectedTab(container: ParentNode): string | undefined {
  return Array.from(container.querySelectorAll('[role="tab"]'))
    .find((tab) => tab.getAttribute("aria-selected") === "true")
    ?.textContent?.trim();
}

afterEach(() => {
  document.body.innerHTML = "";
  holders.hookOnError = undefined;
  mutate.mockReset();
  sendMessageMutate.mockReset();
  mockState.issue = null;
  mockState.issues = [];
  mockState.derived = {};
  mockState.sessions = [];
  liveRunConfirm.midRun = false;
  liveRunConfirm.pending = null;
  resetCockpitLaunchStore();
});
