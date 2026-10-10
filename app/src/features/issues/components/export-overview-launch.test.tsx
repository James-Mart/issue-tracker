// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useSearchParams } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChannelSessionListItem, IssueDetail } from "@server/schemas";
import { ExportOverviewLaunch } from "./export-overview-launch";

const query = vi.hoisted(() => ({
  sessions: [] as ChannelSessionListItem[],
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
    data: [],
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
    data: { events: [], latestSeq: 1 },
    isFetched: true,
    isError: false,
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
  mutate.mockReset();
});

describe("ExportOverviewLaunch", () => {
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
});
