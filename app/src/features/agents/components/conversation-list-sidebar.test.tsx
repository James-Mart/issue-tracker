// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationListItem as ConversationRow } from "@server/schemas";
import { ConversationListSidebar } from "./conversation-list-sidebar";

const activeConversation: ConversationRow = {
  id: "conv-active",
  title: "Active conversation",
  projectId: "issue-tracker",
  model: "composer-2.5-fast",
  activeRun: false,
  archived: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const archivedConversation: ConversationRow = {
  id: "conv-archived",
  title: "Archived conversation",
  projectId: "issue-tracker",
  model: "composer-2.5-fast",
  activeRun: false,
  archived: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
};

const sidebarUi = vi.hoisted(() => ({
  showArchived: false,
  setShowArchived: vi.fn(),
}));

const queryState = vi.hoisted(() => ({
  showArchivedUsed: false as boolean,
  refetch: vi.fn(),
}));

vi.mock("../api/mutations", () => ({
  useUpdateConversation: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}));

vi.mock("@/hooks/use-coarse-pointer", () => ({
  useIsCoarsePointer: () => false,
}));

vi.mock("../store/use-agents-ui-store", () => ({
  useAgentsUiStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      selectedConversationId: null,
      setSelectedConversationId: vi.fn(),
      openCreateDialog: vi.fn(),
      showArchived: sidebarUi.showArchived,
      setShowArchived: sidebarUi.setShowArchived,
      renamingId: null,
      startRename: vi.fn(),
      clearRename: vi.fn(),
      requestDelete: vi.fn(),
    }),
}));

vi.mock("../api/queries", () => ({
  useConversationsQuery: () => {
    queryState.showArchivedUsed = sidebarUi.showArchived;
    return {
      data: sidebarUi.showArchived
        ? [activeConversation, archivedConversation]
        : [activeConversation],
      isLoading: false,
      error: null,
      refetch: queryState.refetch,
      isFetching: false,
    };
  },
}));

vi.mock("@/features/issues/api/queries", () => ({
  useIssuesQuery: () => ({
    data: {
      issues: [
        {
          id: "issue-tracker",
          kind: "project",
          title: "issue-tracker",
        },
      ],
    },
  }),
}));

function mountSidebar(): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<ConversationListSidebar />);
  });
  return { container, root };
}

function archivedToggle(container: ParentNode): HTMLButtonElement {
  const button = container.querySelector('button[title*="archived conversations"]');
  expect(button).toBeTruthy();
  return button as HTMLButtonElement;
}

beforeEach(() => {
  sidebarUi.showArchived = false;
  sidebarUi.setShowArchived.mockImplementation((value: boolean) => {
    sidebarUi.showArchived = value;
  });
  queryState.showArchivedUsed = false;
  queryState.refetch.mockClear();
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ConversationListSidebar", () => {
  it("refetches with showArchived when the archived toggle is enabled", () => {
    const { container, root } = mountSidebar();

    expect(queryState.showArchivedUsed).toBe(false);
    expect(container.textContent).not.toContain("Archived conversation");

    act(() => {
      archivedToggle(container).click();
    });

    expect(sidebarUi.setShowArchived).toHaveBeenCalledWith(true);

    act(() => {
      root.render(<ConversationListSidebar />);
    });

    expect(queryState.showArchivedUsed).toBe(true);
    expect(container.textContent).toContain("Archived conversation");

    act(() => {
      root.unmount();
    });
  });

  it("renders archived rows with distinct styling when revealed", () => {
    sidebarUi.showArchived = true;
    const { container, root } = mountSidebar();

    expect(container.textContent).toContain("Archived conversation");
    expect(container.textContent).toContain("archived");

    const archivedRow = Array.from(container.querySelectorAll(".group")).find(
      (row) => row.textContent?.includes("Archived conversation"),
    );
    expect(archivedRow?.className).toMatch(/\bopacity-60\b/);

    act(() => {
      root.unmount();
    });
  });
});
