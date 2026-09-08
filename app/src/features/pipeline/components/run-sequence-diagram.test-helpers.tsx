import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach } from "vitest";
import type {
  RunSequence,
  RunSequenceSection,
  SequenceBeat,
  SequenceLifeline,
} from "../run-sequence";
import { RunSequenceDiagram } from "./run-sequence-diagram";

export function lifeline(
  id: string,
  kind: SequenceLifeline["kind"] = "role",
): SequenceLifeline {
  return { id, label: id, kind };
}

export function beat(partial: SequenceBeat): SequenceBeat {
  return partial;
}

export const AT = "2026-08-28T12:00:00.000Z";

const BASE_LIFELINES: SequenceLifeline[] = [
  lifeline("human", "human"),
  lifeline("coordinator", "coordinator"),
  lifeline("research"),
];

export const SPAWN = beat({
  from: "coordinator",
  to: "research",
  label: "spawn research",
  startedAt: AT,
  durationMs: 45_000,
  kind: "spawn",
});

export const RETURN = beat({
  from: "research",
  to: "coordinator",
  label: "research returned",
  startedAt: "2026-08-28T12:00:45.000Z",
  durationMs: 92_000,
  kind: "return",
});

export const HUMAN = beat({
  from: "human",
  to: "coordinator",
  label: "human replied",
  startedAt: "2026-08-28T12:02:17.000Z",
  kind: "human-turn",
});

export const COLLAPSED = beat({
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

export function sequence(partial: Partial<RunSequence>): RunSequence {
  return {
    condition: "completed",
    lifelines: BASE_LIFELINES,
    beats: [SPAWN, RETURN, HUMAN],
    sections: [],
    ...partial,
  };
}

export function mountDiagram(
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

export function tipX(arrowhead: Element): number {
  const points = arrowhead.getAttribute("points");
  if (!points) throw new Error("missing arrowhead points");
  return Number(points.trim().split(/[\s,]+/)[0]);
}

export function beatEl(container: ParentNode, from: string, to: string): HTMLElement {
  const el = container.querySelector(
    `[data-testid="sequence-beat"][data-from="${from}"][data-to="${to}"]`,
  );
  if (!(el instanceof HTMLElement)) {
    throw new Error(`missing beat ${from} → ${to}`);
  }
  return el;
}

export function durationText(container: ParentNode, beatIndex: number): string | null {
  return (
    container.querySelector(
      `[data-testid="sequence-duration"][data-beat-index="${beatIndex}"]`,
    )?.textContent ?? null
  );
}

export function tokenText(container: ParentNode, beatIndex: number): string | null {
  return (
    container.querySelector(
      `[data-testid="sequence-tokens"][data-beat-index="${beatIndex}"]`,
    )?.textContent ?? null
  );
}

export function cumulativeText(
  container: ParentNode,
  beatIndex: number,
): string | null {
  return (
    container.querySelector(
      `[data-testid="sequence-cumulative"][data-beat-index="${beatIndex}"]`,
    )?.textContent ?? null
  );
}

export function failureMarks(container: ParentNode): Element[] {
  return Array.from(
    container.querySelectorAll('[data-testid="sequence-failure-mark"]'),
  );
}

export function sectionHeaders(container: ParentNode) {
  return Array.from(
    container.querySelectorAll('[data-testid="sequence-section"]'),
  ).map((el) => ({
    kind: el.getAttribute("data-kind"),
    title: el.querySelector('[data-testid="sequence-section-title"]')
      ?.textContent,
    expanded: el.getAttribute("aria-expanded"),
  }));
}

export const RECONSTRUCTED_CLOSE = beat({
  from: "coordinator",
  to: "research",
  label: "spawn research",
  startedAt: AT,
  durationMs: 42_000,
  kind: "spawn",
});

export const LIVE_FRONTIER = beat({
  from: "coordinator",
  to: "research",
  label: "spawn research",
  startedAt: "2026-08-28T12:03:00.000Z",
  kind: "spawn",
  liveElapsedMs: 2 * 60_000 + 14_000,
});

export const PLANNING_SESSION_SECTION: RunSequenceSection = {
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
