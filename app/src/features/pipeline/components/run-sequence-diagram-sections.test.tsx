// @vitest-environment happy-dom
import { act } from "react";
import { describe, expect, it } from "vitest";
import type { AgentRun, ConversationStreamEvent } from "@server/schemas";
import { applyLiveFrame } from "../live-run-sequence";
import type { RunSequenceSection } from "../run-sequence";
import {
  AT,
  COLLAPSED,
  HUMAN,
  RETURN,
  SPAWN,
  beat,
  lifeline,
  mountDiagram,
  sectionHeaders,
  sequence,
} from "./run-sequence-diagram.test-helpers";

describe("RunSequenceDiagram issue sections", () => {
  const SPAWN_B = beat({
    from: "coordinator",
    to: "research",
    label: "spawn git",
    startedAt: "2026-08-28T12:03:00.000Z",
    durationMs: 22_000,
    kind: "spawn",
  });
  const RETURN_B = beat({
    from: "research",
    to: "coordinator",
    label: "git returned",
    startedAt: "2026-08-28T12:03:22.000Z",
    durationMs: 180_000,
    kind: "return",
  });

  const NESTED_SECTIONS: RunSequenceSection[] = [
    { beatStart: 0, beatEnd: 0, children: [] },
    {
      issueId: "pipeline-fixes",
      kind: "epic",
      title: "Pipeline fixes",
      beatStart: 1,
      beatEnd: 4,
      children: [
        {
          issueId: "run-status-semantics",
          kind: "story",
          title: "Run status semantics",
          beatStart: 1,
          beatEnd: 2,
          children: [],
        },
        {
          issueId: "diagram-grouping",
          kind: "story",
          title: "Diagram issue grouping",
          beatStart: 3,
          beatEnd: 4,
          children: [],
        },
      ],
    },
  ];

  it("renders sections expanded with their headers", () => {
    const { container } = mountDiagram(
      sequence({
        beats: [HUMAN, SPAWN, RETURN, SPAWN_B, RETURN_B],
        sections: NESTED_SECTIONS,
      }),
    );
    expect(sectionHeaders(container)).toEqual([
      { kind: "epic", title: "Pipeline fixes", expanded: "true" },
      { kind: "story", title: "Run status semantics", expanded: "true" },
      { kind: "story", title: "Diagram issue grouping", expanded: "true" },
    ]);
    expect(
      Array.from(
        container.querySelectorAll('[data-testid="sequence-beat"]'),
      ).map((el) => el.getAttribute("data-beat-index")),
    ).toEqual(["0", "1", "2", "3", "4"]);
  });

  it("collapsing a Story section hides its beats while a sibling stays expanded", () => {
    const { container } = mountDiagram(
      sequence({
        beats: [HUMAN, SPAWN, RETURN, SPAWN_B, RETURN_B],
        sections: NESTED_SECTIONS,
      }),
    );
    const story = Array.from(
      container.querySelectorAll('[data-testid="sequence-section"]'),
    ).find(
      (el) =>
        el.querySelector('[data-testid="sequence-section-title"]')
          ?.textContent === "Run status semantics",
    );
    if (!(story instanceof HTMLElement)) {
      throw new Error("missing story section header");
    }
    act(() => {
      story.click();
    });
    expect(story.getAttribute("aria-expanded")).toBe("false");
    expect(
      Array.from(
        container.querySelectorAll('[data-testid="sequence-beat"]'),
      ).map((el) => el.getAttribute("data-beat-index")),
    ).toEqual(["0", "3", "4"]);
    expect(sectionHeaders(container)).toEqual([
      { kind: "epic", title: "Pipeline fixes", expanded: "true" },
      { kind: "story", title: "Run status semantics", expanded: "false" },
      { kind: "story", title: "Diagram issue grouping", expanded: "true" },
    ]);
  });

  it("still renders beats past the section tree's max beatEnd", () => {
    const { container } = mountDiagram(
      sequence({
        condition: "in-flight",
        lifelines: [
          lifeline("coordinator", "coordinator"),
          lifeline("implementor"),
          lifeline("validator"),
        ],
        beats: [
          beat({
            from: "coordinator",
            to: "implementor",
            label: "spawn implementor",
            startedAt: AT,
            kind: "spawn",
            parentCallId: "call-impl",
          }),
          beat({
            from: "implementor",
            to: "validator",
            label: "spawn validator",
            startedAt: "2026-08-28T12:00:12.000Z",
            kind: "spawn",
            parentCallId: "call-qa",
          }),
        ],
        sections: [
          {
            issueId: "run-live-updates",
            kind: "task",
            title: "Keep live-appended beats visible",
            beatStart: 0,
            beatEnd: 0,
            children: [],
          },
        ],
      }),
    );
    expect(
      Array.from(
        container.querySelectorAll('[data-testid="sequence-beat"]'),
      ).map((el) => el.getAttribute("data-beat-index")),
    ).toEqual(["0", "1"]);
  });

  it("renders a live-appended beat after sections that only cover the fetched range", () => {
    const fetched = sequence({
      condition: "in-flight",
      lifelines: [
        lifeline("coordinator", "coordinator"),
        lifeline("implementor"),
      ],
      beats: [
        beat({
          from: "coordinator",
          to: "implementor",
          label: "spawn implementor",
          startedAt: AT,
          kind: "spawn",
          parentCallId: "call-impl",
        }),
      ],
      sections: [
        {
          issueId: "run-live-updates",
          kind: "task",
          title: "Keep live-appended beats visible",
          beatStart: 0,
          beatEnd: 0,
          children: [],
        },
      ],
    });
    const live: ConversationStreamEvent = {
      type: "delegation",
      run: {
        delegationId: "del-qa",
        agentId: "agent-qa",
        role: "validator",
        model: "composer-2.5",
        issueId: "run-live-updates",
        parentCallId: "call-qa",
        conversationId: "conv-live",
        startedAt: "2026-08-28T12:00:12.000Z",
        status: "running",
        isResume: false,
      } satisfies AgentRun,
      at: "2026-08-28T12:00:12.000Z",
      seq: 10,
    };
    const overlaid = applyLiveFrame(fetched, live);

    const desktop = mountDiagram(overlaid);
    expect(
      Array.from(
        desktop.container.querySelectorAll('[data-testid="sequence-beat"]'),
      ).map((el) => ({
        index: el.getAttribute("data-beat-index"),
        from: el.getAttribute("data-from"),
        to: el.getAttribute("data-to"),
      })),
    ).toEqual([
      { index: "0", from: "coordinator", to: "implementor" },
      { index: "1", from: "implementor", to: "validator" },
    ]);

    const phone = mountDiagram(overlaid, "phone");
    expect(
      Array.from(
        phone.container.querySelectorAll('[data-testid="sequence-beat"]'),
      ).map((el) => el.getAttribute("data-beat-index")),
    ).toEqual(["0", "1"]);
  });

  it("keeps a loop group collapsed inside an expanded section", () => {
    const { container } = mountDiagram(
      sequence({
        beats: [COLLAPSED, RETURN],
        sections: [
          {
            issueId: "update-badge-logic",
            kind: "task",
            title: "Update badge logic",
            beatStart: 0,
            beatEnd: 1,
            children: [],
          },
        ],
      }),
    );
    expect(sectionHeaders(container)).toEqual([
      { kind: "task", title: "Update badge logic", expanded: "true" },
    ]);
    expect(
      container.querySelector(
        '[data-testid="sequence-beat"][data-row="collapsed"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-testid="sequence-beat"][data-row="turn"]'),
    ).toBeNull();
  });
});
