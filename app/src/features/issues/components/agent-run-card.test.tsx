// @vitest-environment happy-dom
import { AT, sampleRun } from "./agent-runs-panel.test-helpers";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { AgentRunCard } from "./agent-runs-panel";

describe("AgentRunCard", () => {
  it("shows duration once the run has ended", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <MemoryRouter>
          <AgentRunCard
            issueId="task-1"
            run={sampleRun({
              startedAt: AT,
              endedAt: "2026-07-09T14:00:12.000Z",
            })}
          />
        </MemoryRouter>,
      );
    });

    expect(container.querySelector("[data-duration]")?.textContent).toBe("12s");
    expect(
      container
        .querySelector('[data-testid="agent-run-diagram-link"]')
        ?.getAttribute("href"),
    ).toBe("/runs/conv-1");
  });
});
