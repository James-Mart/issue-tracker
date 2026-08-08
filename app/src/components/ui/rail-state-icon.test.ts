import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { RailNodeState } from "@/features/issues/lib/rail-state";
import { RailPort, StateIcon } from "./rail";

const STATES: RailNodeState[] = [
  "ready",
  "in-flight",
  "blocked",
  "merged",
  "needs-attention",
];

describe("StateIcon", () => {
  it("renders each state with data-state and no visible text label", () => {
    for (const state of STATES) {
      const html = renderToStaticMarkup(
        React.createElement(StateIcon, { state }),
      );
      expect(html).toContain('data-testid="state-icon"');
      expect(html).toContain(`data-state="${state}"`);
      expect(html).toContain('data-testid="rail-port"');
      // accessible name only — no visible label text node beside the disc
      expect(html).not.toMatch(/<\/span><span[^>]*>/);
      expect(html).toMatch(/aria-label="/);
    }
  });

  it("applies distinct hue tokens per state", () => {
    const byState = Object.fromEntries(
      STATES.map((state) => [
        state,
        renderToStaticMarkup(React.createElement(StateIcon, { state })),
      ]),
    ) as Record<RailNodeState, string>;

    expect(byState.ready).toContain("border-[hsl(var(--ink))]");
    expect(byState.ready).toContain("bg-[hsl(var(--void))]");

    expect(byState["in-flight"]).toContain("border-[hsl(var(--current))]");
    expect(byState["in-flight"]).toContain("bg-[hsl(var(--current))]");

    expect(byState.blocked).toContain("border-[hsl(var(--blocked))]");
    expect(byState.blocked).toContain("bg-[hsl(var(--void))]");

    expect(byState.merged).toContain("border-[hsl(var(--merged))]");
    expect(byState.merged).toContain("hsl(var(--merged))");

    expect(byState["needs-attention"]).toContain("border-[hsl(var(--warn))]");
    expect(byState["needs-attention"]).toContain("bg-[hsl(var(--void))]");
  });

  it("glows/pulses only when live is true on an in-flight icon", () => {
    for (const state of STATES) {
      const idle = renderToStaticMarkup(
        React.createElement(StateIcon, { state }),
      );
      expect(idle.includes("[box-shadow:var(--glow)]")).toBe(false);
      expect(idle.includes("animate-live-dot")).toBe(false);
    }

    const live = renderToStaticMarkup(
      React.createElement(StateIcon, { state: "in-flight", live: true }),
    );
    expect(live.includes("[box-shadow:var(--glow)]")).toBe(true);
    expect(live.includes("animate-live-dot")).toBe(true);
  });
});

describe("RailPort shared map", () => {
  it("uses the same appearance tokens as StateIcon", () => {
    for (const state of STATES) {
      const icon = renderToStaticMarkup(
        React.createElement(StateIcon, { state, live: state === "in-flight" }),
      );
      const port = renderToStaticMarkup(
        React.createElement(RailPort, {
          state,
          glow: state === "in-flight",
        }),
      );
      const iconPort = icon.match(
        /data-testid="rail-port"[^>]*class="([^"]*)"/,
      )?.[1];
      const railPort = port.match(
        /data-testid="rail-port"[^>]*class="([^"]*)"/,
      )?.[1];
      expect(iconPort).toBeDefined();
      expect(railPort).toBe(iconPort);
    }
  });
});
