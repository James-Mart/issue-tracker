// @vitest-environment happy-dom
import { act } from "react";
import { describe, expect, it } from "vitest";
import type { RunSequence } from "../run-sequence";
import { OPEN_SPAWN_DASH, RETURN_DASH, beatStroke } from "../run-sequence";
import {
  AT,
  COLLAPSED,
  HUMAN,
  LIVE_FRONTIER,
  PLANNING_SESSION_SECTION,
  RECONSTRUCTED_CLOSE,
  RETURN,
  SPAWN,
  beat,
  beatEl,
  cumulativeText,
  durationText,
  failureMarks,
  mountDiagram,
  sectionHeaders,
  sequence,
  tokenText,
} from "./run-sequence-diagram.test-helpers";

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

  it("renders an open spawn with a cyan dashed shaft and open head", () => {
    const { container } = mountPhone(
      sequence({
        beats: [
          beat({
            from: "coordinator",
            to: "research",
            label: "spawn Research",
            startedAt: AT,
            kind: "spawn",
            indeterminate: true,
          }),
        ],
      }),
    );
    const row = beatEl(container, "coordinator", "research");
    const label = row.querySelector('[data-testid="sequence-beat-label"]');
    expect(label?.textContent).toBe("spawn Research");
    expect(label?.textContent).not.toMatch(/no return/);
    expect(label?.closest("p")?.className).toContain("hsl(var(--current))");
    expect(label?.closest("p")?.className).not.toContain("hsl(var(--warn))");
    expect(row.querySelector(".animate-spin")).toBeNull();
    const arrow = row.querySelector(
      '[data-testid="sequence-arrow"][data-kind="spawn"]',
    );
    expect(arrow?.getAttribute("data-indeterminate")).toBe("true");
    expect(arrow?.getAttribute("data-open")).toBe("true");
    expect(
      arrow?.querySelector('[data-testid="sequence-arrowhead"]'),
    ).toBeNull();
    expect(
      arrow?.querySelector('[data-testid="sequence-arrow-open-head"]'),
    ).not.toBeNull();
    const shaft = arrow?.querySelector('[data-testid="sequence-arrow-shaft"]');
    expect(shaft?.getAttribute("stroke")).toBe("hsl(var(--current))");
    expect(shaft?.getAttribute("stroke-dasharray")).toBe(OPEN_SPAWN_DASH);
  });

  it("stops a failed rail with one failure mark and no off-spine cap", () => {
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
    expect(
      container.querySelector('[data-testid="sequence-termination-cap"]'),
    ).toBeNull();
    expect(failureMarks(container)).toHaveLength(1);
  });

  it("reads completed ports as done, not ready", () => {
    const { container } = mountPhone(sequence({ beats: [SPAWN] }));
    const ports = Array.from(
      container.querySelectorAll('[data-testid="rail-port"]'),
    );
    expect(ports.length).toBeGreaterThan(0);
    for (const port of ports) {
      expect(port.getAttribute("data-state")).toBe("merged");
    }
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

  const PLANNING_FOLDED: RunSequence = sequence({
    lifelines: [
      { id: "human", label: "Human", kind: "human" },
      { id: "coordinator", label: "Stakeholder", kind: "coordinator" },
      { id: "planner", label: "Planner", kind: "role" },
    ],
    beats: [
      beat({
        from: "human",
        to: "coordinator",
        label: "human replied",
        startedAt: AT,
        durationMs: 18_000,
        kind: "human-turn",
        tokenTotal: 428,
        cumulativeMs: 18_000,
      }),
      beat({
        from: "coordinator",
        to: "planner",
        label: "spawn Planner (grok)",
        startedAt: "2026-08-28T12:00:18.000Z",
        durationMs: (10 * 60 + 44) * 1000,
        kind: "spawn",
        tokenTotal: 20_000,
        cumulativeMs: (10 * 60 + 44) * 1000,
      }),
    ],
    tokenTotal: 184_420,
  });

  const FAILED_SPAWN: RunSequence = sequence({
    condition: "failed",
    lifelines: [
      { id: "human", label: "Human", kind: "human" },
      { id: "coordinator", label: "Stakeholder", kind: "coordinator" },
      { id: "planner", label: "Planner", kind: "role" },
    ],
    beats: [
      HUMAN,
      beat({
        from: "coordinator",
        to: "planner",
        label: "spawn Planner (grok)",
        startedAt: AT,
        durationMs: 128_000,
        kind: "spawn",
        tokenTotal: 34_000,
        cumulativeMs: 128_000,
      }),
      beat({
        from: "planner",
        to: "coordinator",
        label: "Planner (grok) failed",
        startedAt: "2026-08-28T12:02:08.000Z",
        durationMs: 128_000,
        kind: "return",
        cumulativeMs: 128_000,
      }),
    ],
  });

  const LIVE_OPEN: RunSequence = sequence({
    condition: "in-flight",
    lifelines: [
      { id: "coordinator", label: "Stakeholder", kind: "coordinator" },
      { id: "mockup-author", label: "Mockup author", kind: "role" },
    ],
    beats: [
      beat({
        from: "coordinator",
        to: "mockup-author",
        label: "spawn Mockup author",
        startedAt: AT,
        kind: "spawn",
        liveElapsedMs: 2 * 60_000 + 14_000,
        tokenTotal: 88_000,
      }),
    ],
  });

  for (const layout of layouts) {
    it(`omits a successful-return row on a completed planning fixture (${layout})`, () => {
      const { container } = mountDiagram(PLANNING_FOLDED, layout);
      const kinds = Array.from(
        container.querySelectorAll('[data-testid="sequence-beat"]'),
      ).map((el) => el.getAttribute("data-kind"));
      expect(kinds).toEqual(["human-turn", "spawn"]);
      expect(kinds).not.toContain("return");
      expect(tokenText(container, 0)).toBe("428");
      expect(durationText(container, 1)).toBe("10m 44s");
      expect(cumulativeText(container, 1)).toBe("10m 44s");
    });

    it(`keeps exactly one failure mark on a failed fixture (${layout})`, () => {
      const { container } = mountDiagram(FAILED_SPAWN, layout);
      expect(failureMarks(container)).toHaveLength(1);
      expect(
        container.querySelector('[data-testid="sequence-termination-cap"]'),
      ).toBeNull();
      const failed = beatEl(container, "planner", "coordinator");
      expect(
        failed.querySelector('[data-testid="sequence-failure-mark"]'),
      ).not.toBeNull();
      expect(
        failed.querySelector('[data-testid="sequence-beat-label"]')
          ?.textContent,
      ).toBe("Planner (grok) failed");
    });

    it(`uses cyan for the live open arrow (${layout})`, () => {
      const { container } = mountDiagram(LIVE_OPEN, layout);
      const arrow = container.querySelector(
        '[data-testid="sequence-arrow"][data-kind="spawn"]',
      );
      expect(arrow?.getAttribute("data-open")).toBe("true");
      const shaft = arrow?.querySelector('[data-testid="sequence-arrow-shaft"]');
      expect(shaft?.getAttribute("stroke")).toBe("hsl(var(--current))");
      expect(shaft?.getAttribute("stroke-dasharray")).toBe(OPEN_SPAWN_DASH);
      expect(shaft?.getAttribute("stroke")).not.toBe("hsl(var(--warn))");
      expect(
        arrow?.querySelector('[data-testid="sequence-arrow-open-head"]'),
      ).not.toBeNull();
      expect(durationText(container, 0)).toBe("2m 14s");
    });
  }

  it("does not clip 10m 44s in metric columns at phone width", () => {
    const { container } = mountDiagram(PLANNING_FOLDED, "phone");
    const duration = container.querySelector(
      '[data-testid="sequence-duration"][data-beat-index="1"]',
    );
    const cumulative = container.querySelector(
      '[data-testid="sequence-cumulative"][data-beat-index="1"]',
    );
    expect(duration?.textContent).toBe("10m 44s");
    expect(cumulative?.textContent).toBe("10m 44s");
    expect(duration?.className).not.toMatch(/overflow-hidden/);
    expect(cumulative?.className).not.toMatch(/overflow-hidden/);
    expect(duration?.className).toMatch(/whitespace-nowrap/);
    expect(duration?.className).toMatch(/shrink-0/);
  });
});
