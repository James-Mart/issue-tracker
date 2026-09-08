// @vitest-environment happy-dom
import { act } from "react";
import { describe, expect, it } from "vitest";
import type { RunSequence } from "../run-sequence";
import { OPEN_SPAWN_DASH, RETURN_DASH, beatStroke } from "../run-sequence";
import {
  AT,
  COLLAPSED,
  RETURN,
  SPAWN,
  beat,
  beatEl,
  failureMarks,
  mountDiagram,
  sequence,
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
