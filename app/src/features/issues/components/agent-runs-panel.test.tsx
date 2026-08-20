// @vitest-environment happy-dom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentRun } from "@server/schemas";
import { AgentRunCard, AgentRunsPanel } from "./agent-runs-panel";

const queryState = vi.hoisted(() => ({
  data: { runs: [] as AgentRun[] },
  isLoading: false,
  error: null as Error | null,
}));

vi.mock("../api/queries", () => ({
  useIssueAgentRunsQuery: () => ({
    data: queryState.data,
    isLoading: queryState.isLoading,
    error: queryState.error,
  }),
}));

const AT = "2026-07-09T14:00:00.000Z";
const AT_MID = "2026-07-09T15:00:00.000Z";
const AT_END = "2026-07-09T16:00:00.000Z";

function sampleRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    delegationId: "del-1",
    agentId: "agent-1",
    role: "issue-tracker-implementor",
    model: "composer-2.5",
    issueId: "task-1",
    parentCallId: "call-1",
    conversationId: "conv-1",
    startedAt: AT,
    status: "completed",
    endedAt: AT_END,
    isResume: false,
    ...overrides,
  };
}

function mountPanel(props: ComponentProps<typeof AgentRunsPanel>): {
  container: HTMLDivElement;
  root: Root;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<AgentRunsPanel {...props} />);
  });
  return { container, root };
}

afterEach(() => {
  document.body.innerHTML = "";
  queryState.data = { runs: [] };
  queryState.isLoading = false;
  queryState.error = null;
});

describe("AgentRunsPanel", () => {
  it("lists runs oldest first with resume marker and distinct status indicators", () => {
    queryState.data = {
      runs: [
        sampleRun({
          delegationId: "del-oldest",
          startedAt: AT,
          status: "running",
          endedAt: undefined,
        }),
        sampleRun({
          delegationId: "del-resume",
          startedAt: AT_MID,
          status: "completed",
          endedAt: AT_END,
          isResume: true,
        }),
        sampleRun({
          delegationId: "del-newest",
          startedAt: AT_END,
          status: "error",
          endedAt: AT_END,
        }),
      ],
    };

    const { container } = mountPanel({ issueId: "task-1" });
    const cards = Array.from(
      container.querySelectorAll("[data-run-id]"),
    ) as HTMLElement[];

    expect(cards.map((card) => card.getAttribute("data-run-id"))).toEqual([
      "del-oldest",
      "del-resume",
      "del-newest",
    ]);

    expect(
      container.querySelector('[data-run-id="del-resume"] [data-resume-marker]'),
    ).toBeTruthy();

    const indicators = cards.map(
      (card) =>
        card.querySelector("[data-status-indicator]")?.getAttribute(
          "data-status-indicator",
        ),
    );
    expect(new Set(indicators)).toEqual(
      new Set(["error", "completed", "running"]),
    );
  });

  it("keeps run headers within a 390px-wide viewport", () => {
    queryState.data = {
      runs: [
        sampleRun({
          role: "issue-tracker-implementor-composer",
          model: "composer-2.5-fast",
          status: "completed",
          endedAt: AT_END,
          isResume: true,
        }),
      ],
    };

    const shell = document.createElement("div");
    shell.style.width = "390px";
    shell.style.overflow = "hidden";
    document.body.appendChild(shell);
    const root = createRoot(shell);
    act(() => {
      root.render(<AgentRunsPanel issueId="task-1" />);
    });

    expect(shell.scrollWidth).toBeLessThanOrEqual(390);
  });
});

describe("AgentRunCard", () => {
  it("shows duration once the run has ended", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <AgentRunCard
          run={sampleRun({
            startedAt: AT,
            endedAt: "2026-07-09T14:00:12.000Z",
          })}
        />,
      );
    });

    expect(container.querySelector("[data-duration]")?.textContent).toBe("12s");
  });
});
