// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewAgentRun, TranscriptEvent } from "@server/schemas";

const state = vi.hoisted(() => ({
  wide: true as boolean | undefined,
  runs: [] as ReviewAgentRun[],
  events: [] as TranscriptEvent[],
}));

vi.mock("../api/queries", () => ({
  useReviewAgentRunsQuery: () => ({
    data: { runs: state.runs },
    isLoading: false,
    error: null,
  }),
}));

vi.mock("../hooks/use-review-comments", () => ({
  useReviewCommentThreads: () => ({ threads: [], problems: [], loaded: true }),
}));

vi.mock("../hooks/use-wide-review-workbench", () => ({
  useWideReviewWorkbench: () => state.wide,
}));

vi.mock("@/features/agents/hooks/use-conversation-events", () => ({
  useConversationEvents: () => ({
    events: state.events,
    ready: true,
    historyFailed: false,
    historyError: null,
    refetchHistory: vi.fn(),
    isRefetchingHistory: false,
    pendingText: null,
    streamRunActive: null,
    loadOlder: vi.fn(),
  }),
}));

import { ReviewAgentsTab } from "./review-agents-tab";

function run(overrides: Partial<ReviewAgentRun> & Pick<ReviewAgentRun, "conversationId" | "role" | "status">): ReviewAgentRun {
  return {
    model: "composer-2.5",
    startedAt: "2026-10-14T16:40:00.000Z",
    ...overrides,
  };
}

const transcript: TranscriptEvent[] = [
  { type: "prompt", text: "role body that must stay out of the card", at: "t0", seq: 1 },
  { type: "assistant", text: "Round 2 will append tasks", at: "t1", seq: 2 },
  { type: "tool_call", callId: "c1", name: "grep", status: "completed", at: "t2", seq: 3 },
  { type: "error", message: "the run failed", at: "t3", seq: 4 },
];

let root: Root | undefined;
let container: HTMLDivElement;

function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  rerender();
}

function rerender() {
  act(() => {
    root!.render(
      <MemoryRouter>
        <ReviewAgentsTab
          projectId="proj"
          reviewId="rev-1"
          onOpenThread={() => {}}
          onOpenThreadId={() => {}}
          onOpenSubmission={() => {}}
          onOpenStandardsRound={() => {}}
        />
      </MemoryRouter>,
    );
  });
}

beforeAll(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
});

beforeEach(() => {
  state.wide = true;
  state.events = transcript;
  state.runs = [];
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

describe("ReviewAgentsTab", () => {
  it("starts a running run expanded on the latest transcript and leaves it when the run finishes", () => {
    state.runs = [
      run({
        conversationId: "conv-tasker",
        role: "issue-tracker-review-tasker",
        status: "running",
        round: 2,
        submittedAt: "2026-10-14T16:00:00.000Z",
        submissionId: "sub-2",
        submittedEntry: false,
      }),
    ];
    mount();

    const card = container.querySelector('[data-conversation-id="conv-tasker"]');
    expect(card?.getAttribute("data-expanded")).toBe("");
    expect(card?.textContent).toContain("Tasker");
    expect(card?.textContent).toContain("Round 2");
    expect(card?.querySelector("[data-testid='review-agent-run-name']")).toBeNull();
    const body = card?.querySelector('[data-slot="agent-run-body"]');
    expect(body?.textContent).toContain("Round 2 will append tasks");
    expect(body?.textContent).toContain("grep");
    expect(body?.querySelector('[data-event="error"]')?.textContent).toContain("the run failed");
    expect(body?.textContent).not.toContain("role body that must stay out of the card");
    expect(body?.querySelector("[data-pinned]")?.getAttribute("data-pinned")).toBe("true");
    expect(card?.querySelector("[data-testid='agent-run-open-in-agents']")?.getAttribute("href")).toBe(
      "/agents/conv-tasker",
    );

    state.runs = [{ ...state.runs[0]!, status: "completed", endedAt: "2026-10-14T16:42:00.000Z" }];
    rerender();
    const finished = container.querySelector('[data-conversation-id="conv-tasker"]');
    expect(finished?.getAttribute("data-expanded")).toBe("");
    expect(finished?.querySelector('[data-slot="agent-run-body"]')).toBe(body);
  });
});

const LIST_CONTENT_PX = 2000;
const PAGE_CONTENT_PX = 3000;
const VIEWPORT_PX = 500;
const scrollTops = new WeakMap<Element, number>();

function isList(el: Element): boolean {
  return el.getAttribute("data-testid") === "review-agents-tab";
}

function contentHeight(el: Element): number {
  if (isList(el)) return LIST_CONTENT_PX;
  if (el === document.documentElement) return PAGE_CONTENT_PX;
  return 0;
}

function viewportHeight(el: Element): number {
  return isList(el) || el === document.documentElement ? VIEWPORT_PX : 0;
}

const fakeGeometry: PropertyDescriptorMap = {
  scrollHeight: { configurable: true, get(this: Element) { return contentHeight(this); } },
  clientHeight: { configurable: true, get(this: Element) { return viewportHeight(this); } },
  scrollTop: {
    configurable: true,
    get(this: Element) {
      return scrollTops.get(this) ?? 0;
    },
    set(this: Element, value: number) {
      const max = Math.max(0, contentHeight(this) - viewportHeight(this));
      scrollTops.set(this, Math.min(Math.max(0, value), max));
    },
  },
};

describe("ReviewAgentsTab scrolling", () => {
  beforeAll(() => {
    Object.defineProperties(HTMLElement.prototype, fakeGeometry);
  });

  afterAll(() => {
    for (const key of Object.keys(fakeGeometry)) {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>)[key];
    }
  });

  it("opens the wide list on the newest run once the width is measured", () => {
    state.runs = Array.from({ length: 21 }, (_, index) =>
      run({
        conversationId: `conv-${index + 1}`,
        role: "issue-tracker-review-tasker",
        status: "completed",
        endedAt: "2026-10-14T16:42:00.000Z",
      }),
    );
    state.wide = undefined;
    mount();
    const list = container.querySelector<HTMLElement>("[data-testid='review-agents-tab']")!;
    expect(list.scrollTop).toBe(0);

    state.wide = true;
    rerender();
    expect(list.scrollTop).toBe(LIST_CONTENT_PX - VIEWPORT_PX);
    expect(document.documentElement.scrollTop).toBe(0);
  });
});
