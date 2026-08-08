// @vitest-environment happy-dom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConversationListItem as ConversationRow } from "@server/schemas";
import {
  ConversationListItem,
  RosterActiveRunIndicator,
} from "./conversation-list-item";

const coarsePointer = vi.hoisted(() => ({ value: false }));

vi.mock("@/hooks/use-coarse-pointer", () => ({
  useIsCoarsePointer: () => coarsePointer.value,
}));

vi.mock("../api/mutations", () => ({
  useUpdateConversation: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}));

vi.mock("../store/use-agents-ui-store", () => ({
  useAgentsUiStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      renamingId: null,
      startRename: vi.fn(),
      clearRename: vi.fn(),
      requestDelete: vi.fn(),
    }),
}));

const sampleConversation: ConversationRow = {
  id: "conv-1",
  title: "Test conversation",
  projectId: "issue-tracker",
  model: "composer-2.5-fast",
  activeRun: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function mountListItem(
  overrides: Partial<ComponentProps<typeof ConversationListItem>> = {},
): {
  container: HTMLDivElement;
  root: Root;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <ConversationListItem
        conversation={sampleConversation}
        projectTitle="issue-tracker"
        isSelected={false}
        onSelect={vi.fn()}
        {...overrides}
      />,
    );
  });
  return { container, root };
}

function actionsButton(container: ParentNode): HTMLButtonElement {
  const button = container.querySelector('button[title="Conversation actions"]');
  expect(button).toBeTruthy();
  return button as HTMLButtonElement;
}

afterEach(() => {
  document.body.innerHTML = "";
  coarsePointer.value = false;
});

describe("RosterActiveRunIndicator", () => {
  it("renders the running marker when activeRun is true", () => {
    const html = renderToStaticMarkup(
      <RosterActiveRunIndicator activeRun={true} />,
    );
    expect(html).toContain('data-testid="roster-active-run"');
    expect(html).toContain('aria-label="Running"');
  });

  it("renders nothing when activeRun is false", () => {
    const html = renderToStaticMarkup(
      <RosterActiveRunIndicator activeRun={false} />,
    );
    expect(html).toBe("");
  });
});

describe("ConversationListItem", () => {
  it("keeps the actions trigger hidden until hover or focus on fine pointers", () => {
    coarsePointer.value = false;
    const { container } = mountListItem();
    const button = actionsButton(container);

    expect(button.className).toMatch(/\bopacity-0\b/);
    expect(button.className).toMatch(/group-hover:opacity-100/);
    expect(button.className).not.toMatch(/\bh-11\b/);
  });

  it("renders the actions trigger visible at a touch target on coarse pointers", () => {
    coarsePointer.value = true;
    const { container } = mountListItem();
    const button = actionsButton(container);

    expect(button.className).toMatch(/\bopacity-100\b/);
    expect(button.className).not.toMatch(/\bopacity-0\b/);
    expect(button.className).toMatch(/\bh-11\b/);
    expect(button.className).toMatch(/\bw-11\b/);
  });
});
