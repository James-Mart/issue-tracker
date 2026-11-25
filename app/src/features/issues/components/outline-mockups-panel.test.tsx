// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import type { ChannelSessionListItem, OutlineMockupStackStatus } from "@server/schemas";
import { OutlineMockupsPanel } from "./outline-mockups-panel";

const fixtures = vi.hoisted(() => ({
  status: undefined as OutlineMockupStackStatus | undefined,
  sessions: [] as ChannelSessionListItem[],
  planning: [] as ChannelSessionListItem[],
  start: vi.fn(),
  stop: vi.fn(),
}));

vi.mock("../api/outline-mockups", () => ({
  useOutlineMockupStackQuery: () => ({
    data: fixtures.status,
    isLoading: fixtures.status === undefined,
    error: null,
  }),
  useStartOutlineMockupStack: () => ({ mutate: fixtures.start, isPending: false }),
  useStopOutlineMockupStack: () => ({ mutate: fixtures.stop, isPending: false }),
  outlineStorybookPath: (sessionId: string) => `/mockups/${sessionId}/`,
}));

vi.mock("../api/queries", () => ({
  useChannelSessionsQuery: (_issueId: string, channel: string) => ({
    data:
      channel === "mockups"
        ? fixtures.sessions
        : channel === "planning"
          ? fixtures.planning
          : [],
    isLoading: false,
    isError: false,
    error: null,
  }),
}));

vi.mock("@/features/agents/components/conversation-thread", () => ({
  ConversationThread: ({
    conversationId,
    banner,
    composerDisabled,
    composerNote,
  }: {
    conversationId: string;
    banner?: ReactNode;
    composerDisabled?: boolean;
    composerNote?: ReactNode;
  }) => (
    <div
      data-testid="conversation-thread"
      data-conversation-id={conversationId}
      data-composer-disabled={composerDisabled ? "true" : "false"}
    >
      {banner}
      {composerNote}
    </div>
  ),
  OpenThreadChrome: () => null,
}));

function session(id: string): ChannelSessionListItem {
  const at = "2026-08-01T00:00:00.000Z";
  return {
    id,
    title: "Mockups Spec",
    model: "composer",
    createdAt: at,
    updatedAt: at,
    archived: false,
    activeRun: false,
    awaitingHuman: false,
    outlineRole: "mockup-author",
  };
}

function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter>
        <OutlineMockupsPanel issueId="spec" projectId="issue-tracker" />
      </MemoryRouter>,
    );
  });
  return { container, root };
}

let root: Root | undefined;

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = undefined;
  document.body.innerHTML = "";
  fixtures.status = undefined;
  fixtures.sessions = [];
  fixtures.planning = [];
  fixtures.start.mockReset();
  fixtures.stop.mockReset();
});

it("keeps the forked author's chat on the empty state", () => {
  fixtures.status = {
    phase: "stopped",
    canRestore: false,
    treeMatchesPack: false,
    authorRun: "clean",
    directions: [],
    sessionId: "agent-mockup",
  };
  fixtures.sessions = [session("agent-mockup")];
  const view = mount();
  root = view.root;
  expect(view.container.textContent).toContain("No mockups for this outline.");
  expect(
    view.container
      .querySelector("[data-testid='conversation-thread']")
      ?.getAttribute("data-conversation-id"),
  ).toBe("agent-mockup");
  expect(view.container.textContent).toContain("forked from mockup author");
  expect(view.container.textContent).not.toMatch(/start a session|new session/i);
});

it("does not render chat when the outline has no forked session", () => {
  fixtures.status = {
    phase: "stopped",
    canRestore: true,
    treeMatchesPack: false,
    authorRun: "clean",
    directions: ["alpha"],
  };
  const view = mount();
  root = view.root;
  expect(view.container.querySelector("[data-testid='conversation-thread']")).toBeNull();
  expect(view.container.textContent).toContain("Start mockups stack");
});

it("pauses the composer while Planning holds the outline", () => {
  fixtures.status = {
    phase: "live",
    canRestore: true,
    treeMatchesPack: true,
    authorRun: "clean",
    directions: [],
    sessionId: "agent-mockup",
  };
  fixtures.sessions = [session("agent-mockup")];
  fixtures.planning = [{ ...session("planner"), title: "Planning Spec", activeRun: true, outlineRole: "planner" }];
  const view = mount();
  root = view.root;
  expect(
    view.container.querySelector("[data-testid='conversation-thread']")?.getAttribute("data-composer-disabled"),
  ).toBe("true");
  expect(view.container.textContent).toContain("Planning Spec");
});
