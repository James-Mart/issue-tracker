// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentsPage } from "./agents-page";

vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("./conversation-list-sidebar", () => ({
  ConversationListSidebar: () => (
    <div data-testid="conversation-list-sidebar">Sidebar</div>
  ),
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
      </MemoryRouter>,
    );
  });
  return { container, root };
}

afterEach(() => {
  document.body.innerHTML = "";
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
});
