// @vitest-environment happy-dom
import {
  AT,
  AT_MID,
  deliverTopic,
  mountPanel,
  PROJECT_ID,
  queryState,
  sampleRun,
} from "./agent-runs-panel.test-helpers";
import { describe, expect, it } from "vitest";
import { issuesKeys } from "../api/keys";

describe("AgentRunsPanel", () => {
  it("ignores a delegation frame whose run belongs to a different issue", () => {
    queryState.data = {
      runs: [sampleRun()],
      workRoot: { issueId: "ship-it", conversationId: "conv-coordinator" },
    };

    const { container } = mountPanel({ issueId: "task-1", projectId: PROJECT_ID });

    deliverTopic("conversation:conv-coordinator", {
      type: "event",
      seq: 11,
      event: {
        type: "delegation",
        run: sampleRun({
          delegationId: "del-other",
          issueId: "other-task",
          parentCallId: "call-other",
          status: "running",
          endedAt: undefined,
        }),
        at: AT_MID,
        seq: 11,
      },
    });

    expect(container.querySelector('[data-run-id="del-other"]')).toBeNull();
    expect(container.querySelectorAll("[data-run-id]")).toHaveLength(1);
  });

  it("flips status and fills duration when a delegation_end matches parentCallId", () => {
    queryState.data = {
      runs: [
        sampleRun({
          delegationId: "del-live",
          parentCallId: "call-1",
          startedAt: AT,
          status: "running",
          endedAt: undefined,
        }),
      ],
      workRoot: { issueId: "ship-it", conversationId: "conv-coordinator" },
    };

    const { container } = mountPanel({ issueId: "task-1", projectId: PROJECT_ID });
    const card = container.querySelector('[data-run-id="del-live"]') as HTMLElement;
    expect(card.getAttribute("data-status")).toBe("running");
    expect(card.querySelector("[data-duration]")).toBeNull();

    deliverTopic("conversation:conv-coordinator", {
      type: "event",
      seq: 12,
      event: {
        type: "delegation_end",
        delegationId: "del-live",
        parentCallId: "call-1",
        status: "completed",
        endedAt: "2026-07-09T14:00:12.000Z",
        at: "2026-07-09T14:00:12.000Z",
        seq: 12,
      },
    });

    expect(card.getAttribute("data-status")).toBe("completed");
    expect(
      card.querySelector("[data-status-indicator]")?.getAttribute(
        "data-status-indicator",
      ),
    ).toBe("completed");
    expect(card.querySelector("[data-duration]")?.textContent).toBe("12s");
  });

  it("drops the live overlay and invalidates agent runs on topic reset", () => {
    queryState.data = {
      runs: [sampleRun({ delegationId: "del-seed" })],
      workRoot: { issueId: "ship-it", conversationId: "conv-coordinator" },
    };

    const { container, invalidateSpy } = mountPanel({
      issueId: "task-1",
      projectId: PROJECT_ID,
    });

    deliverTopic("conversation:conv-coordinator", {
      type: "event",
      seq: 10,
      event: {
        type: "delegation",
        run: sampleRun({
          delegationId: "del-live",
          parentCallId: "call-live",
          startedAt: AT_MID,
          status: "running",
          endedAt: undefined,
        }),
        at: AT_MID,
        seq: 10,
      },
    });
    expect(container.querySelector('[data-run-id="del-live"]')).toBeTruthy();

    deliverTopic("conversation:conv-coordinator", { type: "reset" });

    expect(container.querySelector('[data-run-id="del-live"]')).toBeNull();
    expect(container.querySelector('[data-run-id="del-seed"]')).toBeTruthy();
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: issuesKeys.agentRuns("task-1"),
    });
  });
});
