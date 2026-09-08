// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { RunSequence } from "../run-sequence";
import { OPEN_SPAWN_DASH } from "../run-sequence";
import {
  AT,
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
