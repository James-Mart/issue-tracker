// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentRun, ConversationStreamEvent } from "@server/schemas";
import { applyLiveFrame } from "../live-run-sequence";
import type {
  RunSequence,
  RunSequenceSection,
  SequenceBeat,
  SequenceLifeline,
} from "../run-sequence";
import { RETURN_DASH, beatStroke } from "../run-sequence";
import {
  RunSequenceDiagram,
  lifelineX,
} from "./run-sequence-diagram";

function lifeline(
  id: string,
  kind: SequenceLifeline["kind"] = "role",
): SequenceLifeline {
  return { id, label: id, kind };
}

function beat(partial: SequenceBeat): SequenceBeat {
  return partial;
}

const AT = "2026-08-28T12:00:00.000Z";

const BASE_LIFELINES: SequenceLifeline[] = [
  lifeline("human", "human"),
  lifeline("coordinator", "coordinator"),
  lifeline("research"),
];

const SPAWN = beat({
  from: "coordinator",
  to: "research",
  label: "spawn research",
  startedAt: AT,
  durationMs: 45_000,
  kind: "spawn",
});

const RETURN = beat({
  from: "research",
  to: "coordinator",
  label: "research returned",
  startedAt: "2026-08-28T12:00:45.000Z",
  durationMs: 92_000,
  kind: "return",
});

const HUMAN = beat({
  from: "human",
  to: "coordinator",
  label: "human replied",
  startedAt: "2026-08-28T12:02:17.000Z",
  kind: "human-turn",
});

const COLLAPSED = beat({
  from: "coordinator",
  to: "research",
  label: "spawn research",
  startedAt: AT,
  durationMs: 90_000,
  kind: "spawn",
  turns: [
    { label: "spawn research", startedAt: AT, durationMs: 28_000 },
    {
      label: "respawn after fix",
      startedAt: "2026-08-28T12:00:28.000Z",
      durationMs: 30_000,
    },
    {
      label: "spawn research",
      startedAt: "2026-08-28T12:00:58.000Z",
      durationMs: 32_000,
    },
  ],
});

function sequence(partial: Partial<RunSequence>): RunSequence {
  return {
    condition: "completed",
    lifelines: BASE_LIFELINES,
    beats: [SPAWN, RETURN, HUMAN],
    sections: [],
    ...partial,
  };
}

function mountDiagram(
  model: RunSequence,
  layout?: "desktop" | "phone",
): {
  container: HTMLDivElement;
  root: Root;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<RunSequenceDiagram sequence={model} layout={layout} />);
  });
  return { container, root };
}

function tipX(arrowhead: Element): number {
  const points = arrowhead.getAttribute("points");
  if (!points) throw new Error("missing arrowhead points");
  return Number(points.trim().split(/[\s,]+/)[0]);
}

function beatEl(container: ParentNode, from: string, to: string): HTMLElement {
  const el = container.querySelector(
    `[data-testid="sequence-beat"][data-from="${from}"][data-to="${to}"]`,
  );
  if (!(el instanceof HTMLElement)) {
    throw new Error(`missing beat ${from} → ${to}`);
  }
  return el;
}

function durationText(container: ParentNode, beatIndex: number): string | null {
  return (
    container.querySelector(
      `[data-testid="sequence-duration"][data-beat-index="${beatIndex}"]`,
    )?.textContent ?? null
  );
}

function sectionHeaders(container: ParentNode) {
  return Array.from(
    container.querySelectorAll('[data-testid="sequence-section"]'),
  ).map((el) => ({
    kind: el.getAttribute("data-kind"),
    title: el.querySelector('[data-testid="sequence-section-title"]')
      ?.textContent,
    expanded: el.getAttribute("aria-expanded"),
  }));
}

const RECONSTRUCTED_CLOSE = beat({
  from: "coordinator",
  to: "research",
  label: "spawn research",
  startedAt: AT,
  durationMs: 42_000,
  kind: "spawn",
});

const LIVE_FRONTIER = beat({
  from: "coordinator",
  to: "research",
  label: "spawn research",
  startedAt: "2026-08-28T12:03:00.000Z",
  kind: "spawn",
  liveElapsedMs: 2 * 60_000 + 14_000,
});

const PLANNING_SESSION_SECTION: RunSequenceSection = {
  issueId: "diff-views",
  kind: "idea",
  title: "Diff views",
  beatStart: 0,
  beatEnd: 2,
  children: [],
};

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("RunSequenceDiagram", () => {
  it("reads a beat's direction from its arrowhead", () => {
    const { container } = mountDiagram(sequence({}));
    const arrows = Array.from(
      container.querySelectorAll('[data-testid="sequence-arrow"]'),
    );
    const spawn = arrows.find((el) => el.getAttribute("data-kind") === "spawn");
    const ret = arrows.find((el) => el.getAttribute("data-kind") === "return");
    if (!spawn || !ret) throw new Error("missing spawn or return arrow");
    const spawnHead = spawn.querySelector('[data-testid="sequence-arrowhead"]');
    const returnHead = ret.querySelector('[data-testid="sequence-arrowhead"]');
    if (!spawnHead || !returnHead) throw new Error("missing arrowheads");

    const coordinatorX = lifelineX(1, 3);
    const researchX = lifelineX(2, 3);
    expect(Math.abs(tipX(spawnHead) - researchX)).toBeLessThan(
      Math.abs(tipX(spawnHead) - coordinatorX),
    );
    expect(Math.abs(tipX(returnHead) - coordinatorX)).toBeLessThan(
      Math.abs(tipX(returnHead) - researchX),
    );
    expect(tipX(spawnHead)).toBeGreaterThan(coordinatorX);
    expect(tipX(returnHead)).toBeLessThan(researchX);
  });

  it("draws a collapsed beat's count beside the label", () => {
    const { container } = mountDiagram(
      sequence({ beats: [COLLAPSED, RETURN] }),
    );
    const collapsed = container.querySelector(
      '[data-testid="sequence-beat"][data-row="collapsed"]',
    );
    if (!(collapsed instanceof HTMLElement)) {
      throw new Error("missing collapsed beat");
    }
    expect(
      collapsed.querySelector('[data-testid="sequence-beat-label"]')
        ?.textContent,
    ).toBe("spawn research");
    expect(
      collapsed.querySelector('[data-testid="sequence-iteration-count"]')
        ?.textContent,
    ).toBe("×3");
    expect(collapsed.querySelector('[data-testid="sequence-beat-label"]')).not.toBe(
      collapsed.querySelector('[data-testid="sequence-iteration-count"]'),
    );
    expect(
      container.querySelector(
        '[data-testid="sequence-duration"][data-row="collapsed"]',
      )?.textContent,
    ).toBe("1m 30s");
  });

  it("expands a collapsed beat so every turn keeps its name and duration", () => {
    const { container } = mountDiagram(
      sequence({ beats: [COLLAPSED, RETURN] }),
    );
    const expand = container.querySelector(
      '[data-testid="sequence-beat"][data-row="collapsed"] button',
    );
    if (!(expand instanceof HTMLElement)) {
      throw new Error("missing expand control");
    }
    act(() => {
      expand.click();
    });

    expect(
      container.querySelector('[data-testid="sequence-beat"][data-row="collapsed"]'),
    ).toBeNull();
    const turns = Array.from(
      container.querySelectorAll('[data-testid="sequence-beat"][data-row="turn"]'),
    );
    expect(
      turns.map((el, index) => ({
        label: el.querySelector('[data-testid="sequence-beat-label"]')?.textContent,
        duration: container.querySelectorAll(
          '[data-testid="sequence-duration"][data-row="turn"]',
        )[index]?.textContent,
      })),
    ).toEqual([
      { label: "spawn research", duration: "28s" },
      { label: "respawn after fix", duration: "30s" },
      { label: "spawn research", duration: "32s" },
    ]);
    expect(
      container.querySelector('[data-testid="sequence-loop-bracket"]'),
    ).not.toBeNull();
    const head = container.querySelector('[data-testid="sequence-group-head"]');
    expect(head?.textContent).toContain("Collapse");
    expect(
      head?.querySelector('[data-testid="sequence-iteration-count"]')?.textContent,
    ).toBe("×3");
  });

  it("extends completed lifelines past the last beat", () => {
    const { container } = mountDiagram(sequence({}));
    const diagram = container.querySelector(
      '[data-testid="run-sequence-diagram"]',
    );
    expect(diagram?.getAttribute("data-tail")).toBe("extend");
    const lastY = Number(beatEl(container, "human", "coordinator").dataset.y);
    const bodies = Array.from(
      container.querySelectorAll('[data-testid="sequence-lifeline-body"]'),
    );
    expect(bodies.length).toBe(3);
    for (const line of bodies) {
      expect(Number(line.getAttribute("y2"))).toBeGreaterThan(lastY);
    }
    expect(
      container.querySelector('[data-testid="sequence-lifeline-open-tail"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="sequence-termination-cap"]'),
    ).toBeNull();
  });

  it("continues in-flight lifelines as open dashed tails", () => {
    const { container } = mountDiagram(
      sequence({
        condition: "in-flight",
        beats: [
          SPAWN,
          beat({
            from: "coordinator",
            to: "research",
            label: "spawn research",
            startedAt: "2026-08-28T12:03:00.000Z",
            kind: "spawn",
          }),
        ],
      }),
    );
    const diagram = container.querySelector(
      '[data-testid="run-sequence-diagram"]',
    );
    expect(diagram?.getAttribute("data-tail")).toBe("open-dash");
    const liveBeats = Array.from(
      container.querySelectorAll(
        '[data-testid="sequence-beat"][data-from="coordinator"][data-to="research"]',
      ),
    ) as HTMLElement[];
    const lastY = Number(liveBeats[liveBeats.length - 1]?.dataset.y);
    const bodies = Array.from(
      container.querySelectorAll('[data-testid="sequence-lifeline-body"]'),
    );
    for (const line of bodies) {
      expect(Number(line.getAttribute("y2"))).toBe(lastY);
    }
    const tails = container.querySelectorAll(
      '[data-testid="sequence-lifeline-open-tail"]',
    );
    expect(tails.length).toBe(3);
    for (const tail of Array.from(tails)) {
      expect(tail.getAttribute("stroke-dasharray")).toBe("3 4");
      expect(Number(tail.getAttribute("y2"))).toBeGreaterThan(lastY);
    }
  });

  it("stops a failed run at a termination cap on the lifeline that failed", () => {
    const { container } = mountDiagram(
      sequence({
        condition: "failed",
        beats: [
          SPAWN,
          beat({
            from: "research",
            to: "coordinator",
            label: "research failed",
            startedAt: "2026-08-28T12:01:00.000Z",
            durationMs: 12_000,
            kind: "return",
          }),
        ],
      }),
    );
    const diagram = container.querySelector(
      '[data-testid="run-sequence-diagram"]',
    );
    expect(diagram?.getAttribute("data-tail")).toBe("stop");
    const lastY = Number(beatEl(container, "research", "coordinator").dataset.y);
    const bodies = Array.from(
      container.querySelectorAll('[data-testid="sequence-lifeline-body"]'),
    );
    for (const line of bodies) {
      expect(Number(line.getAttribute("y2"))).toBeLessThanOrEqual(lastY + 12);
      expect(Number(line.getAttribute("y2"))).toBeGreaterThan(lastY);
    }
    expect(
      container.querySelector('[data-testid="sequence-lifeline-open-tail"]'),
    ).toBeNull();
    const cap = container.querySelector(
      '[data-testid="sequence-termination-cap"]',
    );
    expect(cap?.getAttribute("data-lifeline")).toBe("research");
  });

  it("renders an indeterminate beat with a no-return caption and no spinner", () => {
    const { container } = mountDiagram(
      sequence({
        beats: [
          beat({
            from: "coordinator",
            to: "research",
            label: "spawn research",
            startedAt: AT,
            kind: "spawn",
            indeterminate: true,
          }),
        ],
      }),
    );
    const label = beatEl(container, "coordinator", "research").querySelector(
      '[data-testid="sequence-beat-label"]',
    );
    expect(label?.textContent).toBe("spawn research · no return");
    expect(label?.className).toContain("hsl(var(--warn))");
    expect(label?.querySelector(".animate-spin")).toBeNull();
    const arrow = container.querySelector(
      '[data-testid="sequence-arrow"][data-kind="spawn"]',
    );
    expect(arrow?.getAttribute("data-indeterminate")).toBe("true");
    expect(
      arrow?.querySelector('[data-testid="sequence-arrowhead"]'),
    ).toBeNull();
    expect(
      arrow?.querySelector('[data-testid="sequence-arrow-open-terminus"]'),
    ).not.toBeNull();
    const shaft = arrow?.querySelector('[data-testid="sequence-arrow-shaft"]');
    expect(shaft?.getAttribute("stroke")).toBe("hsl(var(--warn))");
    expect(shaft?.getAttribute("stroke-dasharray")).toBe("5 4");
  });

  it("strips the harness prefix from variant captions without touching the model name", () => {
    const { container } = mountDiagram(
      sequence({
        lifelines: [
          lifeline("human", "human"),
          lifeline("coordinator", "coordinator"),
          lifeline("issue-tracker-implementor"),
        ],
        beats: [
          beat({
            from: "coordinator",
            to: "issue-tracker-implementor",
            label: "spawn issue-tracker-implementor (composer)",
            startedAt: AT,
            durationMs: 45_000,
            kind: "spawn",
          }),
          beat({
            from: "issue-tracker-implementor",
            to: "coordinator",
            label: "issue-tracker-implementor (sonnet) returned",
            startedAt: "2026-08-28T12:00:45.000Z",
            durationMs: 12_000,
            kind: "return",
          }),
        ],
      }),
    );
    const labels = Array.from(
      container.querySelectorAll('[data-testid="sequence-beat-label"]'),
    ).map((el) => el.textContent);
    expect(labels).toEqual([
      "spawn implementor (composer)",
      "implementor (sonnet) returned",
    ]);
  });

  it("still draws beats after a mid-run failure", () => {
    const { container } = mountDiagram(
      sequence({
        condition: "failed",
        beats: [
          SPAWN,
          beat({
            from: "research",
            to: "coordinator",
            label: "research failed",
            startedAt: "2026-08-28T12:01:00.000Z",
            durationMs: 12_000,
            kind: "return",
          }),
          HUMAN,
        ],
      }),
    );
    const failed = beatEl(container, "research", "coordinator");
    const later = beatEl(container, "human", "coordinator");
    const failY = Number(failed.dataset.y);
    const lastY = Number(later.dataset.y);
    expect(later.getAttribute("data-kind")).toBe("human-turn");
    expect(lastY).toBeGreaterThan(failY);
    const cap = container.querySelector(
      '[data-testid="sequence-termination-cap"]',
    );
    expect(cap?.getAttribute("data-lifeline")).toBe("research");
    expect(Number.parseFloat((cap as HTMLElement).style.top)).toBe(failY + 8);
    const bodies = Array.from(
      container.querySelectorAll('[data-testid="sequence-lifeline-body"]'),
    );
    for (const line of bodies) {
      const y2 = Number(line.getAttribute("y2"));
      expect(y2).toBeGreaterThan(lastY);
      expect(y2).toBeLessThanOrEqual(lastY + 12);
    }
  });
});

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

describe("RunSequenceDiagram phone rail", () => {
  function mountPhone(model: RunSequence) {
    return mountDiagram(model, "phone");
  }

  it("lays one Rail row per beat and names from and to on the row", () => {
    const { container } = mountPhone(sequence({}));
    const diagram = container.querySelector(
      '[data-testid="run-sequence-diagram"]',
    );
    expect(diagram?.getAttribute("data-layout")).toBe("phone");
    const beats = Array.from(
      container.querySelectorAll('[data-testid="sequence-beat"]'),
    );
    expect(beats).toHaveLength(3);
    expect(
      beats.map((el) => ({
        from: el.getAttribute("data-from"),
        to: el.getAttribute("data-to"),
        fromLabel: el.querySelector('[data-testid="sequence-from"]')
          ?.textContent,
        toLabel: el.querySelector('[data-testid="sequence-to"]')?.textContent,
        listitem: el.getAttribute("role"),
      })),
    ).toEqual([
      {
        from: "coordinator",
        to: "research",
        fromLabel: "coordinator",
        toLabel: "research",
        listitem: "listitem",
      },
      {
        from: "research",
        to: "coordinator",
        fromLabel: "research",
        toLabel: "coordinator",
        listitem: "listitem",
      },
      {
        from: "human",
        to: "coordinator",
        fromLabel: "human",
        toLabel: "coordinator",
        listitem: "listitem",
      },
    ]);
    expect(container.querySelector(".truncate")).toBeNull();
  });

  it("keeps kind encodings on the row arrows", () => {
    const { container } = mountPhone(sequence({}));
    const arrows = Array.from(
      container.querySelectorAll('[data-testid="sequence-arrow"]'),
    );
    const byKind = Object.fromEntries(
      arrows.map((el) => [el.getAttribute("data-kind"), el]),
    );
    const spawn = beatStroke("spawn");
    const ret = beatStroke("return");
    const human = beatStroke("human-turn");
    expect(
      byKind.spawn
        ?.querySelector('[data-testid="sequence-arrow-shaft"]')
        ?.getAttribute("stroke-width"),
    ).toBe(String(spawn.width));
    expect(
      byKind.return
        ?.querySelector('[data-testid="sequence-arrow-shaft"]')
        ?.getAttribute("stroke-dasharray"),
    ).toBe(RETURN_DASH);
    expect(
      byKind["human-turn"]
        ?.querySelector('[data-testid="sequence-arrow-shaft"]')
        ?.getAttribute("stroke-width"),
    ).toBe(String(human.width));
    expect(human.width).toBeGreaterThan(spawn.width);
    expect(ret.dash).toBe("return");
  });

  it("draws a collapsed beat's count beside the label", () => {
    const { container } = mountPhone(sequence({ beats: [COLLAPSED, RETURN] }));
    const collapsed = container.querySelector(
      '[data-testid="sequence-beat"][data-row="collapsed"]',
    );
    if (!(collapsed instanceof HTMLElement)) {
      throw new Error("missing collapsed beat");
    }
    expect(
      collapsed.querySelector('[data-testid="sequence-beat-label"]')
        ?.textContent,
    ).toBe("spawn research");
    expect(
      collapsed.querySelector('[data-testid="sequence-iteration-count"]')
        ?.textContent,
    ).toBe("×3");
    expect(collapsed.querySelector('[data-testid="sequence-beat-label"]')).not.toBe(
      collapsed.querySelector('[data-testid="sequence-iteration-count"]'),
    );
    expect(
      container.querySelector(
        '[data-testid="sequence-duration"][data-row="collapsed"]',
      )?.textContent,
    ).toBe("1m 30s");
  });

  it("expands a collapsed beat so every turn keeps its name and duration", () => {
    const { container } = mountPhone(sequence({ beats: [COLLAPSED, RETURN] }));
    const expand = container.querySelector(
      '[data-testid="sequence-beat"][data-row="collapsed"] button',
    );
    if (!(expand instanceof HTMLElement)) {
      throw new Error("missing expand control");
    }
    act(() => {
      expand.click();
    });

    expect(
      container.querySelector('[data-testid="sequence-beat"][data-row="collapsed"]'),
    ).toBeNull();
    const turns = Array.from(
      container.querySelectorAll('[data-testid="sequence-beat"][data-row="turn"]'),
    );
    expect(
      turns.map((el, index) => ({
        label: el.querySelector('[data-testid="sequence-beat-label"]')?.textContent,
        duration: container.querySelectorAll(
          '[data-testid="sequence-duration"][data-row="turn"]',
        )[index]?.textContent,
      })),
    ).toEqual([
      { label: "spawn research", duration: "28s" },
      { label: "respawn after fix", duration: "30s" },
      { label: "spawn research", duration: "32s" },
    ]);
    expect(
      container.querySelector('[data-testid="sequence-loop-bracket"]'),
    ).not.toBeNull();
    const head = container.querySelector('[data-testid="sequence-group-head"]');
    expect(head?.textContent).toContain("Collapse");
    expect(
      head?.querySelector('[data-testid="sequence-iteration-count"]')?.textContent,
    ).toBe("×3");
  });

  it("extends a completed rail past the last beat", () => {
    const { container } = mountPhone(sequence({}));
    const diagram = container.querySelector(
      '[data-testid="run-sequence-diagram"]',
    );
    expect(diagram?.getAttribute("data-tail")).toBe("extend");
    expect(
      container.querySelector('[data-testid="sequence-lifeline-open-tail"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-testid="sequence-termination-cap"]'),
    ).toBeNull();
    const rail = container.querySelector('[role="list"]');
    expect(rail?.className).toMatch(/pb-6/);
  });

  it("continues an in-flight rail as an open dashed tail", () => {
    const { container } = mountPhone(
      sequence({
        condition: "in-flight",
        beats: [
          SPAWN,
          beat({
            from: "coordinator",
            to: "research",
            label: "spawn research",
            startedAt: "2026-08-28T12:03:00.000Z",
            kind: "spawn",
          }),
        ],
      }),
    );
    const diagram = container.querySelector(
      '[data-testid="run-sequence-diagram"]',
    );
    expect(diagram?.getAttribute("data-tail")).toBe("open-dash");
    const tail = container.querySelector(
      '[data-testid="sequence-lifeline-open-tail"]',
    );
    expect(tail).not.toBeNull();
    const dash = tail?.querySelector("line") ?? tail;
    expect(dash?.getAttribute("stroke-dasharray")).toBe("3 4");
    expect(
      container.querySelector('[data-testid="sequence-termination-cap"]'),
    ).toBeNull();
  });

  it("renders an indeterminate beat with a no-return caption and no spinner", () => {
    const { container } = mountPhone(
      sequence({
        beats: [
          beat({
            from: "coordinator",
            to: "research",
            label: "spawn research",
            startedAt: AT,
            kind: "spawn",
            indeterminate: true,
          }),
        ],
      }),
    );
    const row = beatEl(container, "coordinator", "research");
    const label = row.querySelector('[data-testid="sequence-beat-label"]');
    expect(label?.textContent).toBe("spawn research · no return");
    expect(label?.closest("p")?.className).toContain("hsl(var(--warn))");
    expect(row.querySelector(".animate-spin")).toBeNull();
    const arrow = row.querySelector(
      '[data-testid="sequence-arrow"][data-kind="spawn"]',
    );
    expect(arrow?.getAttribute("data-indeterminate")).toBe("true");
    expect(
      arrow?.querySelector('[data-testid="sequence-arrowhead"]'),
    ).toBeNull();
    expect(
      arrow?.querySelector('[data-testid="sequence-arrow-open-terminus"]'),
    ).not.toBeNull();
  });

  it("stops a failed rail at a termination cap on the lifeline that failed", () => {
    const { container } = mountPhone(
      sequence({
        condition: "failed",
        beats: [
          SPAWN,
          beat({
            from: "research",
            to: "coordinator",
            label: "research failed",
            startedAt: "2026-08-28T12:01:00.000Z",
            durationMs: 12_000,
            kind: "return",
          }),
        ],
      }),
    );
    const diagram = container.querySelector(
      '[data-testid="run-sequence-diagram"]',
    );
    expect(diagram?.getAttribute("data-tail")).toBe("stop");
    expect(
      container.querySelector('[data-testid="sequence-lifeline-open-tail"]'),
    ).toBeNull();
    const cap = container.querySelector(
      '[data-testid="sequence-termination-cap"]',
    );
    expect(cap?.getAttribute("data-lifeline")).toBe("research");
  });
});

describe("RunSequenceDiagram chosen direction", () => {
  const layouts = ["desktop", "phone"] as const;

  for (const layout of layouts) {
    it(`shows a gutter duration and no no-return suffix on a reconstructed close (${layout})`, () => {
      const { container } = mountDiagram(
        sequence({ beats: [RECONSTRUCTED_CLOSE, RETURN] }),
        layout,
      );
      const row = beatEl(container, "coordinator", "research");
      expect(
        row.querySelector('[data-testid="sequence-beat-label"]')?.textContent,
      ).toBe("spawn research");
      expect(row.textContent).not.toMatch(/no return/);
      expect(durationText(container, 0)).toBe("42s");
      expect(durationText(container, 1)).toBe("1m 32s");
    });

    it(`shows live elapsed on the frontier without a gutter ellipsis (${layout})`, () => {
      const { container } = mountDiagram(
        sequence({
          condition: "in-flight",
          beats: [SPAWN, LIVE_FRONTIER],
        }),
        layout,
      );
      const row = beatEl(container, "coordinator", "research");
      const liveRows = Array.from(
        container.querySelectorAll(
          '[data-testid="sequence-beat"][data-from="coordinator"][data-to="research"]',
        ),
      );
      const frontier = liveRows[liveRows.length - 1]!;
      expect(
        frontier.querySelector('[data-testid="sequence-beat-label"]')
          ?.textContent,
      ).toBe("spawn research");
      expect(frontier.textContent).not.toMatch(/no return/);
      expect(durationText(container, 1)).toBe("2m 14s");
      expect(durationText(container, 1)).not.toMatch(/…/);
      expect(frontier.querySelector('[class*="animate-spin"]')).not.toBeNull();
      expect(row.querySelector('[class*="animate-spin"]')).toBeNull();
    });

    it(`renders one session section wrapper and no extra headers (${layout})`, () => {
      const { container } = mountDiagram(
        sequence({
          beats: [HUMAN, SPAWN, RETURN],
          sections: [PLANNING_SESSION_SECTION],
        }),
        layout,
      );
      expect(sectionHeaders(container)).toEqual([
        { kind: "idea", title: "Diff views", expanded: "true" },
      ]);
      expect(
        container.querySelectorAll('[data-testid="sequence-section"]'),
      ).toHaveLength(1);
      expect(
        Array.from(
          container.querySelectorAll('[data-testid="sequence-beat"]'),
        ).map((el) => el.getAttribute("data-beat-index")),
      ).toEqual(["0", "1", "2"]);
    });
  }

  it("lets the phone sheet body scroll a rail taller than the viewport", () => {
    const { container } = mountDiagram(
      sequence({ beats: [RECONSTRUCTED_CLOSE, RETURN] }),
      "phone",
    );
    const frame = container.querySelector(
      '[data-testid="run-sequence-frame"]',
    );
    expect(frame?.className).toMatch(/overflow-visible/);
    expect(frame?.className).not.toMatch(/min-h-\[16rem\]/);
    expect(frame?.className).not.toMatch(/overflow-auto/);
    expect(frame?.className).not.toMatch(/max-h-/);
  });
});
