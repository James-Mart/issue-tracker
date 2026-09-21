// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConversationListItem } from "@server/schemas";
import { useAgentsUiStore } from "../store/use-agents-ui-store";
import { AgentsPage } from "./agents-page";

const queryState = vi.hoisted(() => ({
  data: undefined as ConversationListItem[] | undefined,
}));

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("../api/queries", () => ({
  useConversationsQuery: () => ({
    data: queryState.data,
  }),
}));

vi.mock("./conversation-list-sidebar", () => ({
  ConversationListSidebar: function ConversationListSidebar() {
    const showArchived = useAgentsUiStore((s) => s.showArchived);
    return (
      <div data-testid="conversation-list-sidebar">
        Sidebar
        {showArchived ? (
          <div data-testid="archived-rows">Archived conversation</div>
        ) : null}
      </div>
    );
  },
}));

vi.mock("./conversation-thread", () => ({
  ConversationThread: ({ conversationId }: { conversationId: string }) => (
    <div data-testid="conversation-thread" data-conversation-id={conversationId}>
      Thread
    </div>
  ),
}));

vi.mock("./create-conversation-dialog", () => ({
  CreateConversationDialog: () => null,
}));

vi.mock("./delete-conversation-dialog", () => ({
  DeleteConversationDialog: () => null,
}));

function LocationProbe() {
  const { pathname } = useLocation();
  return <div data-testid="location-probe">{pathname}</div>;
}

function conversation(
  overrides: Partial<ConversationListItem> & Pick<ConversationListItem, "id">,
): ConversationListItem {
  return {
    title: overrides.title ?? overrides.id,
    projectId: "issue-tracker",
    model: "composer-2.5-fast",
    activeRun: false,
    archived: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function mountAgentsPage(initialEntry: string): {
  container: HTMLDivElement;
  root: Root;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/agents/:conversationId" element={<AgentsPage />} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>,
    );
  });
  return { container, root };
}

afterEach(() => {
  document.body.innerHTML = "";
  queryState.data = undefined;
  useAgentsUiStore.setState({ showArchived: false });
});

describe("AgentsPage route selection", () => {
  it("opens the conversation thread from the URL param", () => {
    const { container, root } = mountAgentsPage("/agents/conv-1");

    const thread = container.querySelector('[data-testid="conversation-thread"]');
    expect(thread).not.toBeNull();
    expect(thread?.getAttribute("data-conversation-id")).toBe("conv-1");
    expect(container.textContent).not.toContain("No conversation selected.");

    act(() => {
      root.unmount();
    });
  });

  it("shows the empty state on the roster route", () => {
    const { container, root } = mountAgentsPage("/agents");

    expect(
      container.querySelector('[data-testid="conversation-thread"]'),
    ).toBeNull();
    expect(container.textContent).toContain("No conversation selected.");

    act(() => {
      root.unmount();
    });
  });

  it("replaces an unknown conversation path with the roster empty state", () => {
    queryState.data = [conversation({ id: "conv-1" })];
    const { container, root } = mountAgentsPage("/agents/does-not-exist");

    expect(
      container.querySelector('[data-testid="conversation-thread"]'),
    ).toBeNull();
    expect(container.textContent).toContain("No conversation selected.");
    expect(
      container.querySelector('[data-testid="location-probe"]')?.textContent,
    ).toBe("/agents");

    act(() => {
      root.unmount();
    });
  });

  it("opens an archived conversation and reveals archived rows", () => {
    queryState.data = [
      conversation({ id: "conv-1" }),
      conversation({ id: "conv-archived", title: "Archived conversation", archived: true }),
    ];
    const { container, root } = mountAgentsPage("/agents/conv-archived");

    const thread = container.querySelector('[data-testid="conversation-thread"]');
    expect(thread).not.toBeNull();
    expect(thread?.getAttribute("data-conversation-id")).toBe("conv-archived");
    expect(container.querySelector('[data-testid="archived-rows"]')).not.toBeNull();
    expect(useAgentsUiStore.getState().showArchived).toBe(true);

    act(() => {
      root.unmount();
    });
  });
});
