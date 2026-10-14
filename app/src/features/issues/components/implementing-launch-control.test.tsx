// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImplementingWorkRoot } from "@server/services/implementing-launch";
import { resetCockpitLaunchStore } from "../store/use-cockpit-launch-store";
import { ImplementingChannelEmptyState } from "./implementing-launch-control";

const mutate = vi.fn();

vi.mock("../api/queries", () => ({
  useChannelSessionsQuery: () => ({
    data: [],
    isLoading: false,
    error: null,
  }),
}));

vi.mock("../hooks/use-issues-with-archived", () => ({
  useIssuesWithArchived: () => ({
    data: {
      issues: [
        {
          id: "ship-it",
          kind: "epic",
          title: "Ship it",
          partOf: "platform",
          blockedBy: [],
          order: 0,
          archived: false,
          needsAttention: false,
          attentionReason: null,
          createdAt: "2026-08-10T12:00:00.000Z",
          updatedAt: "2026-08-10T12:00:00.000Z",
        },
      ],
      derived: { "ship-it": { blocked: false, epicStatus: "todo" } },
    },
  }),
}));

vi.mock("../api/mutations", () => ({
  useEnqueueWorkRoot: (issueId: string) => ({
    mutate: (...args: unknown[]) => {
      mutate(issueId, ...args);
    },
    isPending: false,
  }),
}));

const epic: ImplementingWorkRoot = {
  kind: "epic",
  id: "ship-it",
  title: "Ship it",
  partOf: "platform",
  blockedBy: [],
  order: 0,
  archived: false,
  needsAttention: false,
  attentionReason: null,
  createdAt: "2026-08-10T12:00:00.000Z",
  updatedAt: "2026-08-10T12:00:00.000Z",
  description: "",
  version: "1",
};

function mount(
  ui: React.ReactElement,
): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<MemoryRouter>{ui}</MemoryRouter>);
  });
  return { container, root };
}

afterEach(() => {
  document.body.innerHTML = "";
  mutate.mockReset();
  resetCockpitLaunchStore();
});

describe("ImplementingChannelEmptyState", () => {
  it("queues from the ListEnd control instead of creating a session", () => {
    const { container } = mount(<ImplementingChannelEmptyState issue={epic} />);
    const button = container.querySelector(
      '[data-testid="implementing-queue"]',
    ) as HTMLButtonElement;

    expect(button.getAttribute("aria-label")).toBe("Queue");
    act(() => {
      button.click();
    });

    expect(mutate).toHaveBeenCalledWith("ship-it");
    expect(container.querySelector("svg")).toBeTruthy();
  });
});
