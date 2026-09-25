// @vitest-environment happy-dom
import { act } from "react";
import { describe, expect, it } from "vitest";
import type { SequenceBeat } from "../run-sequence";
import { beat, mountDiagram, sequence } from "./run-sequence-diagram.test-helpers";

const RESEARCH: SequenceBeat = beat({
  from: "coordinator",
  to: "research",
  label: "spawn Research",
  startedAt: "2026-09-24T22:30:17.000Z",
  durationMs: 186_000,
  kind: "spawn",
  parentCallId: "toolu_01Qru2Lx93953zU9c7L1GXBC",
  absorbedReplays: [
    {
      toolCallId: "toolu_01Qru2Lx93953zU9c7L1GXBC",
      tool: "delegate",
      outcome: "joined-in-flight",
      at: "2026-09-24T22:31:04.028Z",
    },
  ],
});

describe("absorbed replay on the pipeline run", () => {
  for (const layout of ["desktop", "phone"] as const) {
    it(`shows the chip and the joined-in-flight detail without a second spawn (${layout})`, () => {
      const { container } = mountDiagram(
        sequence({
          beats: [RESEARCH],
          lifelines: [
            { id: "coordinator", label: "Stakeholder", kind: "coordinator" },
            { id: "research", label: "Research", kind: "role" },
          ],
        }),
        layout,
      );
      const chip = container.querySelector('[data-testid="absorbed-replay-chip"]');
      expect(chip?.textContent).toBe("absorbed ×1");
      expect(
        container.querySelector('[data-testid="absorbed-replay-detail"]'),
      ).toBeNull();
      expect(container.querySelectorAll('[data-testid="sequence-arrow"]')).toHaveLength(1);

      const button = chip?.closest("button");
      if (!button) throw new Error("missing absorbed replay button");
      act(() => {
        button.click();
      });

      const detail = container.querySelector(
        '[data-testid="absorbed-replay-detail"]',
      );
      expect(detail?.getAttribute("data-outcome")).toBe("joined-in-flight");
      expect(detail?.textContent).toContain(
        "SDK re-invoked delegate with the same tool call; the tool did not run again.",
      );
      expect(detail?.textContent).toContain("Joined the in-flight call.");
      expect(detail?.textContent).toContain("toolu_01Qru2Lx93953zU9c7L1GXBC");
      expect(
        container.querySelectorAll('[data-testid="sequence-beat"]'),
      ).toHaveLength(1);
    });
  }

  it("states when the replay returned the stored result", () => {
    const stored: SequenceBeat = {
      ...RESEARCH,
      absorbedReplays: [
        {
          toolCallId: "toolu_01Qru2Lx93953zU9c7L1GXBC",
          tool: "delegate",
          outcome: "returned-stored-result",
          at: "2026-09-24T22:58:12.000Z",
        },
      ],
    };
    const { container } = mountDiagram(sequence({ beats: [stored] }));
    const button = container.querySelector(
      '[data-testid="absorbed-replay-chip"]',
    )?.closest("button");
    if (!button) throw new Error("missing absorbed replay button");
    act(() => {
      button.click();
    });
    const detail = container.querySelector(
      '[data-testid="absorbed-replay-detail"]',
    );
    expect(detail?.getAttribute("data-outcome")).toBe("returned-stored-result");
    expect(detail?.textContent).toContain(
      "Returned the stored result — replay after the original finished.",
    );
  });
});
