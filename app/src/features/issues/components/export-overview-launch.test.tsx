// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useSearchParams } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChannelSessionListItem, IssueDetail } from "@server/schemas";
import type { Attachment } from "@server/services/attachments";
import {
  exportSessionMessage,
  exportSessionTitle,
} from "../lib/export-launch";
import { ExportOverviewLaunch } from "./export-overview-launch";

const query = vi.hoisted(() => ({
  sessions: [] as ChannelSessionListItem[],
  attachments: [] as Attachment[],
  events: [] as { type: string; status?: string }[],
  transcriptFetched: true,
  transcriptError: false,
}));

const mutate = vi.hoisted(() => vi.fn());

vi.mock("../api/queries", () => ({
  useChannelSessionsQuery: () => ({
    data: query.sessions,
    isLoading: false,
    isError: false,
    error: null,
  }),
  useAttachmentsQuery: () => ({
    data: query.attachments,
    isLoading: false,
    isError: false,
    error: null,
  }),
}));

vi.mock("@/features/agents/api/queries", () => ({
  useAgentModelsQuery: () => ({
    data: { models: [{ id: "composer-2.5", displayName: "Composer 2.5" }] },
    isLoading: false,
  }),
  useConversationTranscriptQuery: () => ({
    data: query.transcriptFetched ? { events: query.events, latestSeq: 1 } : undefined,
    isFetched: query.transcriptFetched,
    isError: query.transcriptError,
    isLoading: false,
  }),
}));

vi.mock("../api/mutations", () => ({
  useCreateChannelSession: () => ({
    mutate: (...args: unknown[]) => mutate(...args),
    isPending: false,
  }),
}));

const t0 = "2026-08-01T00:00:00.000Z";

const epic: IssueDetail = {
  id: "auth",
  kind: "epic",
  title: "Auth hardening",
  partOf: "issue-tracker",
  order: 0,
  createdAt: t0,
  updatedAt: t0,
  blockedBy: [],
  archived: false,
  description: "",
  version: "1",
  labels: [],
  needsAttention: false,
  attentionReason: null,
};

function session(
  overrides: Partial<ChannelSessionListItem> = {},
): ChannelSessionListItem {
  return {
    id: "exp-1",
    title: "Export Auth hardening",
    model: "composer-2.5",
    createdAt: t0,
    updatedAt: t0,
    archived: false,
    activeRun: false,
    awaitingHuman: false,
    ...overrides,
  };
}

function SearchProbe() {
  const [params] = useSearchParams();
  return <div data-testid="search">{params.toString()}</div>;
}

function mount(): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter>
        <ExportOverviewLaunch issue={epic} onTabVisible={() => {}} />
        <SearchProbe />
      </MemoryRouter>,
    );
  });
  return { container, root };
}

function click(container: ParentNode, testId: string) {
  act(() => {
    (container.querySelector(`[data-testid="${testId}"]`) as HTMLButtonElement).click();
  });
}

afterEach(() => {
  document.body.innerHTML = "";
  query.sessions = [];
  query.attachments = [];
  query.events = [];
  query.transcriptFetched = true;
  query.transcriptError = false;
  mutate.mockReset();
});

describe("ExportOverviewLaunch", () => {
  it("posts one export session and opens the Export tab", () => {
    mutate.mockImplementation((_body: unknown, opts: { onSuccess?: (result: { id: string }) => void }) => {
      query.sessions = [session({ activeRun: true })];
      opts.onSuccess?.({ id: "exp-1" });
    });
    const { container } = mount();
    expect(container.textContent).toContain(
      "Propose GitHub issues from this epic — opens Export.",
    );
    click(container, "export-overview-start");
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]?.[0]).toEqual({
      model: "composer-2.5",
      title: exportSessionTitle(epic.title),
      message: exportSessionMessage(epic.id),
    });
    expect(container.querySelector('[data-testid="search"]')?.textContent).toBe(
      "tab=export",
    );
    click(container, "export-overview-open");
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("re-opens a live export without posting", () => {
    query.sessions = [session({ activeRun: true })];
    const { container } = mount();
    expect(container.querySelector('[data-phase="running"]')).toBeTruthy();
    expect(container.textContent).toContain("Export in progress");
    click(container, "export-overview-open");
    expect(mutate).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="search"]')?.textContent).toBe(
      "tab=export",
    );
  });

  it("keeps a failed first run on Open Export without posting", () => {
    query.sessions = [session()];
    query.events = [{ type: "error" }];
    const { container } = mount();
    expect(container.querySelector('[data-phase="failed"]')).toBeTruthy();
    expect(container.textContent).toContain("Export failed");
    click(container, "export-overview-open");
    expect(mutate).not.toHaveBeenCalled();
  });

  it("counts drafts and only navigates", () => {
    query.sessions = [session()];
    query.attachments = [
      { name: "github-export-auth.md", size: 10, mtime: t0, mime: "text/markdown" },
      { name: "notes.md", size: 4, mtime: t0, mime: "text/markdown" },
      { name: "github-export-session.md", size: 8, mtime: t0, mime: "text/markdown" },
    ];
    const { container } = mount();
    expect(container.querySelector('[data-phase="drafts-ready"]')).toBeTruthy();
    expect(container.textContent).toContain("2 drafts attached — open Export to review.");
    click(container, "export-overview-open");
    expect(mutate).not.toHaveBeenCalled();
  });

  it("returns to the start control after a completed session loses its drafts", () => {
    query.sessions = [session()];
    query.events = [{ type: "assistant" }];
    const { container } = mount();
    expect(container.querySelector('[data-phase="idle"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="export-overview-start"]')).toBeTruthy();
  });
});
