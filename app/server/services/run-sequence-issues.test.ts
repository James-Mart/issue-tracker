import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AT,
  AT_CHILD,
  AT_EARLY,
  AT_END,
  AT_LATE,
  AT_LATE_END,
  AT_ROUND1_END,
  AT_ROUND2_END,
  delegation,
  expectLeafCoverage,
  loadRunSequence,
  prompt,
  setupRunSequenceTest,
  teardownRunSequenceTest,
  toolCall,
  usage,
  writeConversation,
  writeIssue,
  writeWorkTree,
} from "./run-sequence.fixtures.js";

beforeEach(() => {
  setupRunSequenceTest();
});

afterEach(() => {
  teardownRunSequenceTest();
});

describe("runSequence", () => {
  it("emits a human-turn beat on the human lifeline", async () => {
    writeConversation("conv-human", {
      meta: { issueId: "capture", channel: "planning" },
      transcript: [prompt("approve outline", AT, 1)],
    });

    const runSequence = await loadRunSequence();
    const sequence = runSequence("conv-human");

    expect(sequence.condition).toBe("completed");
    expect(sequence.lifelines).toEqual([
      { id: "human", label: "Human", kind: "human" },
      { id: "coordinator", label: "Stakeholder", kind: "coordinator" },
    ]);
    expect(sequence.beats).toEqual([
      {
        from: "human",
        to: "coordinator",
        label: "human replied",
        startedAt: AT,
        kind: "human-turn",
        cumulativeMs: 0,
      },
    ]);
  });

  it("resolves rootIssue from the earliest delegation issue", async () => {
    writeIssue("platform", {
      kind: "project",
      title: "Platform",
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("first-issue", {
      kind: "task",
      title: "First task",
      partOf: "platform",
      createdAt: AT,
      updatedAt: AT,
    });
    writeIssue("second-issue", {
      kind: "task",
      title: "Second task",
      partOf: "platform",
      createdAt: AT,
      updatedAt: AT,
    });
    writeConversation("conv-root-issue", {
      meta: {
        channel: "implementing",
        issueId: "first-issue",
        createdAt: AT,
      },
      delegations: [
        delegation({
          delegationId: "del-first",
          agentId: "agent-first",
          role: "implementor",
          model: "composer-2.5",
          at: AT,
          issueId: "first-issue",
          parentCallId: "call-first",
          end: { status: "completed", endedAt: AT_END },
        }),
        delegation({
          delegationId: "del-second",
          agentId: "agent-second",
          role: "validator",
          model: "composer-2.5",
          at: AT_LATE,
          issueId: "second-issue",
          parentCallId: "call-second",
          end: { status: "completed", endedAt: AT_LATE },
        }),
      ],
      transcript: [
        toolCall("call-first", "running", AT, 1),
        toolCall("call-first", "completed", AT_END, 2),
        toolCall("call-second", "running", AT_LATE, 3),
        toolCall("call-second", "completed", AT_LATE, 4),
      ],
    });

    const runSequence = await loadRunSequence();
    const sequence = runSequence("conv-root-issue");

    expect(sequence.rootIssue).toEqual({
      id: "first-issue",
      kind: "task",
      title: "First task",
      projectId: "platform",
    });
  });

  it("omits rootIssue when no delegation carries an issueId", async () => {
    writeConversation("conv-no-issue", {
      meta: { title: "Ad hoc debug", createdAt: AT },
      delegations: [
        delegation({
          delegationId: "del-research",
          agentId: "agent-research",
          role: "research",
          model: "composer-2.5",
          at: AT,
          parentCallId: "call-research",
          end: { status: "completed", endedAt: AT_END },
        }),
      ],
      transcript: [
        toolCall("call-research", "running", AT, 1),
        toolCall("call-research", "completed", AT_END, 2),
      ],
    });

    const runSequence = await loadRunSequence();
    const sequence = runSequence("conv-no-issue");

    expect(sequence).not.toHaveProperty("rootIssue");
  });

  it("derives one lifeline per role family and names each model variant on beats", async () => {
    writeConversation("conv-variant-implementors", {
      meta: { issueId: "capture", channel: "implementing" },
      delegations: [
        delegation({
          delegationId: "del-composer",
          agentId: "agent-composer",
          role: "issue-tracker-implementor-composer",
          model: "composer-2.5",
          at: AT,
          parentCallId: "call-composer",
          end: { status: "completed", endedAt: AT_ROUND1_END },
        }),
        delegation({
          delegationId: "del-sonnet",
          agentId: "agent-sonnet",
          role: "issue-tracker-implementor-sonnet",
          model: "claude-sonnet",
          at: AT,
          parentCallId: "call-sonnet",
          end: { status: "completed", endedAt: AT_ROUND2_END },
        }),
      ],
      transcript: [
        toolCall("call-composer", "running", AT, 1),
        toolCall("call-sonnet", "running", AT, 2),
        toolCall("call-composer", "completed", AT_ROUND1_END, 3),
        toolCall("call-sonnet", "completed", AT_ROUND2_END, 4),
      ],
    });

    const runSequence = await loadRunSequence();
    const sequence = runSequence("conv-variant-implementors");

    expect(sequence.lifelines).toEqual([
      { id: "coordinator", label: "Coordinator", kind: "coordinator" },
      {
        id: "issue-tracker-implementor",
        label: "Implementor",
        kind: "role",
      },
    ]);
    expect(sequence.beats).toHaveLength(1);
    expect(sequence.beats[0]).toEqual({
      from: "coordinator",
      to: "issue-tracker-implementor",
      label: "spawn Implementor (composer)",
      startedAt: AT,
      durationMs: Date.parse(AT_ROUND2_END) - Date.parse(AT),
      cumulativeMs: Date.parse(AT_ROUND2_END) - Date.parse(AT),
      kind: "spawn",
      parentCallId: "call-sonnet",
      turns: [
        {
          label: "spawn Implementor (composer)",
          startedAt: AT,
          durationMs: Date.parse(AT_ROUND1_END) - Date.parse(AT),
        },
        {
          label: "spawn Implementor (sonnet)",
          startedAt: AT,
          durationMs: Date.parse(AT_ROUND2_END) - Date.parse(AT),
        },
      ],
    });
  });

  it("omits rootIssue when the earliest issue id no longer resolves", async () => {
    writeConversation("conv-dangling", {
      meta: { title: "Historical run", createdAt: AT },
      delegations: [
        delegation({
          delegationId: "del-gone",
          agentId: "agent-gone",
          role: "implementor",
          model: "composer-2.5",
          at: AT,
          issueId: "deleted-issue",
          parentCallId: "call-gone",
          end: { status: "completed", endedAt: AT_END },
        }),
      ],
      transcript: [
        toolCall("call-gone", "running", AT, 1),
        toolCall("call-gone", "completed", AT_END, 2),
      ],
    });

    const runSequence = await loadRunSequence();
    const sequence = runSequence("conv-dangling");

    expect(sequence).not.toHaveProperty("rootIssue");
    expect(sequence.sections).toEqual([
      { beatStart: 0, beatEnd: 0, children: [] },
    ]);
  });

  it("wraps a planning run in the session issue when delegations disagree", async () => {
    writeWorkTree();
    writeConversation("conv-planning-session", {
      meta: { channel: "planning", issueId: "story-one", createdAt: AT },
      delegations: [
        delegation({
          delegationId: "del-polish",
          agentId: "agent-polish",
          role: "polish",
          model: "composer-2.5",
          at: AT,
          issueId: "task-a",
          parentCallId: "call-polish",
          end: { status: "completed", endedAt: AT_ROUND1_END },
        }),
        delegation({
          delegationId: "del-research",
          agentId: "agent-research",
          role: "research",
          model: "composer-2.5",
          at: AT_CHILD,
          parentCallId: "call-research",
          end: { status: "completed", endedAt: AT_END },
        }),
        delegation({
          delegationId: "del-mockup",
          agentId: "agent-mockup",
          role: "mockup-author",
          model: "composer-2.5",
          at: AT_LATE,
          issueId: "task-b",
          parentCallId: "call-mockup",
          end: { status: "completed", endedAt: AT_LATE_END },
        }),
      ],
      transcript: [
        prompt("refine scope", AT_EARLY, 1),
        toolCall("call-polish", "running", AT, 2),
        toolCall("call-polish", "completed", AT_ROUND1_END, 3),
        toolCall("call-research", "running", AT_CHILD, 4),
        toolCall("call-research", "completed", AT_END, 5),
        toolCall("call-mockup", "running", AT_LATE, 6),
        toolCall("call-mockup", "completed", AT_LATE_END, 7),
      ],
    });

    const runSequence = await loadRunSequence();
    const sequence = runSequence("conv-planning-session");

    expect(sequence.rootIssue).toEqual({
      id: "story-one",
      kind: "story",
      title: "Story One",
      projectId: "proj",
    });
    expect(sequence.sections).toEqual([
      {
        issueId: "epic-one",
        kind: "epic",
        title: "Epic One",
        beatStart: 0,
        beatEnd: 3,
        children: [
          {
            issueId: "story-one",
            kind: "story",
            title: "Story One",
            beatStart: 0,
            beatEnd: 3,
            children: [],
          },
        ],
      },
    ]);
    expectLeafCoverage(sequence.sections, sequence.beats.length);
  });

  it("nests two Tasks under one Story and keeps a mid-run human in the open section", async () => {
    writeWorkTree();
    writeConversation("conv-nested-tasks", {
      meta: { channel: "implementing", issueId: "task-a", createdAt: AT },
      delegations: [
        delegation({
          delegationId: "del-a",
          agentId: "agent-a",
          role: "implementor",
          model: "composer-2.5",
          at: AT,
          issueId: "task-a",
          parentCallId: "call-a",
          end: { status: "completed", endedAt: AT_ROUND1_END },
        }),
        delegation({
          delegationId: "del-b",
          agentId: "agent-b",
          role: "implementor",
          model: "composer-2.5",
          at: AT_LATE,
          issueId: "task-b",
          parentCallId: "call-b",
          end: { status: "completed", endedAt: AT_LATE_END },
        }),
      ],
      transcript: [
        prompt("start", AT_EARLY, 1),
        toolCall("call-a", "running", AT, 2),
        toolCall("call-a", "completed", AT_ROUND1_END, 3),
        prompt("continue", AT_CHILD, 4),
        toolCall("call-b", "running", AT_LATE, 5),
        toolCall("call-b", "completed", AT_LATE_END, 6),
      ],
    });

    const runSequence = await loadRunSequence();
    const sequence = runSequence("conv-nested-tasks");

    expect(sequence.beats.map((b) => b.label)).toEqual([
      "human replied",
      "spawn Implementor",
      "human replied",
      "spawn Implementor",
    ]);
    expect(sequence.sections).toEqual([
      { beatStart: 0, beatEnd: 0, children: [] },
      {
        issueId: "epic-one",
        kind: "epic",
        title: "Epic One",
        beatStart: 1,
        beatEnd: 3,
        children: [
          {
            issueId: "story-one",
            kind: "story",
            title: "Story One",
            beatStart: 1,
            beatEnd: 3,
            children: [
              {
                issueId: "task-a",
                kind: "task",
                title: "Task A",
                beatStart: 1,
                beatEnd: 2,
                children: [],
              },
              {
                issueId: "task-b",
                kind: "task",
                title: "Task B",
                beatStart: 3,
                beatEnd: 3,
                children: [],
              },
            ],
          },
        ],
      },
    ]);
    expectLeafCoverage(sequence.sections, sequence.beats.length);
  });

  it("does not collapse consecutive same-pair beats tagged with different issues", async () => {
    writeWorkTree();
    writeConversation("conv-no-cross-issue-collapse", {
      meta: { channel: "implementing", issueId: "task-a", createdAt: AT },
      delegations: [
        delegation({
          delegationId: "del-a",
          agentId: "agent-a",
          role: "implementor",
          model: "composer-2.5",
          at: AT,
          issueId: "task-a",
          parentCallId: "call-a",
          end: { status: "completed", endedAt: AT_ROUND1_END },
        }),
        delegation({
          delegationId: "del-b",
          agentId: "agent-b",
          role: "implementor",
          model: "composer-2.5",
          at: AT,
          issueId: "task-b",
          parentCallId: "call-b",
          end: { status: "completed", endedAt: AT_ROUND2_END },
        }),
      ],
      transcript: [
        toolCall("call-a", "running", AT, 1),
        toolCall("call-b", "running", AT, 2),
        toolCall("call-a", "completed", AT_ROUND1_END, 3),
        toolCall("call-b", "completed", AT_ROUND2_END, 4),
      ],
    });

    const runSequence = await loadRunSequence();
    const sequence = runSequence("conv-no-cross-issue-collapse");

    expect(sequence.beats.map((b) => [b.kind, b.from, b.to])).toEqual([
      ["spawn", "coordinator", "implementor"],
      ["spawn", "coordinator", "implementor"],
    ]);
    expect(sequence.beats[0]).not.toHaveProperty("turns");
    expect(sequence.beats[1]).not.toHaveProperty("turns");
    expect(
      sequence.sections[0]?.children[0]?.children.map((s) => s.issueId),
    ).toEqual(["task-a", "task-b"]);
  });

  it("attributes nested and root usage, stamps wall-clock cumulativeMs, and folds a successful spawn", async () => {
    writeConversation("conv-usage-fold", {
      meta: { channel: "planning", issueId: "capture", createdAt: AT },
      delegations: [
        delegation({
          delegationId: "del-research",
          agentId: "agent-research",
          role: "research",
          model: "composer-2.5",
          at: AT_END,
          parentCallId: "call-research",
          end: { status: "completed", endedAt: AT_CHILD },
        }),
      ],
      transcript: [
        prompt("go", AT, 1),
        usage({ totalTokens: 420, at: AT_END, seq: 2 }),
        toolCall("call-research", "running", AT_END, 3),
        usage({
          totalTokens: 19000,
          at: AT_CHILD,
          seq: 4,
          parentCallId: "call-research",
        }),
        toolCall("call-research", "completed", AT_CHILD, 5),
      ],
    });

    const runSequence = await loadRunSequence();
    const sequence = runSequence("conv-usage-fold");

    expect(sequence.tokenTotal).toBe(19_420);
    expect(sequence.lifelines.map((line) => line.label)).toEqual([
      "Human",
      "Stakeholder",
      "Research",
    ]);
    expect(sequence.beats.map((b) => b.kind)).toEqual(["human-turn", "spawn"]);
    expect(sequence.beats[0]).toMatchObject({
      kind: "human-turn",
      tokenTotal: 420,
      cumulativeMs: 0,
    });
    expect(sequence.beats[1]).toMatchObject({
      kind: "spawn",
      label: "spawn Research",
      tokenTotal: 19_000,
      durationMs: Date.parse(AT_CHILD) - Date.parse(AT_END),
      cumulativeMs: Date.parse(AT_CHILD) - Date.parse(AT),
    });
    expect(sequence.beats.some((b) => b.kind === "return")).toBe(false);
  });

  it("keeps a failed spawn's own return beat and still totals its usage", async () => {
    writeConversation("conv-usage-fail", {
      meta: { channel: "implementing", issueId: "ship-it", createdAt: AT },
      delegations: [
        delegation({
          delegationId: "del-planner",
          agentId: "agent-planner",
          role: "planner-grok",
          model: "grok-4.5",
          at: AT,
          parentCallId: "call-planner",
          end: { status: "error", endedAt: AT_END },
        }),
      ],
      transcript: [
        toolCall("call-planner", "running", AT, 1),
        usage({
          totalTokens: 34_000,
          at: AT_END,
          seq: 2,
          parentCallId: "call-planner",
        }),
        toolCall("call-planner", "error", AT_END, 3),
      ],
    });

    const runSequence = await loadRunSequence();
    const sequence = runSequence("conv-usage-fail");

    expect(sequence.condition).toBe("failed");
    expect(sequence.tokenTotal).toBe(34_000);
    expect(sequence.lifelines).toEqual([
      { id: "coordinator", label: "Coordinator", kind: "coordinator" },
      { id: "planner", label: "Planner", kind: "role" },
    ]);
    expect(sequence.beats[0]).toMatchObject({
      kind: "spawn",
      label: "spawn Planner (grok)",
      tokenTotal: 34_000,
      cumulativeMs: Date.parse(AT_END) - Date.parse(AT),
    });
    expect(sequence.beats[1]).toMatchObject({
      kind: "return",
      label: "Planner (grok) failed",
      cumulativeMs: Date.parse(AT_END) - Date.parse(AT),
    });
  });
});
