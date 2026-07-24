import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import {
  DependencyGraph,
  layoutDepGraph,
} from "./dependency-graph";
import type { DepGraphModel } from "@/features/issues/lib/flow";

/** Diamond: C → A, C → B, A → D, B → D */
const diamondModel: DepGraphModel = {
  nodes: [
    { id: "C", label: "C", state: "merged" },
    { id: "A", label: "A", state: "in-flight" },
    { id: "B", label: "B", state: "blocked" },
    { id: "D", label: "D", state: "blocked" },
  ],
  edges: [
    { from: "C", to: "A", satisfied: true },
    { from: "C", to: "B", satisfied: true },
    { from: "A", to: "D", satisfied: false },
    { from: "B", to: "D", satisfied: false },
  ],
};

describe("layoutDepGraph", () => {
  it("layers the diamond prerequisites above dependents", () => {
    const layout = layoutDepGraph(diamondModel);
    const byId = Object.fromEntries(layout.nodes.map((n) => [n.id, n]));

    expect(byId.C!.y).toBeLessThan(byId.A!.y);
    expect(byId.C!.y).toBeLessThan(byId.B!.y);
    expect(byId.A!.y).toBe(byId.B!.y);
    expect(byId.A!.y).toBeLessThan(byId.D!.y);
    expect(byId.A!.x).not.toBe(byId.B!.x);

    expect(layout.edges).toHaveLength(4);
    for (const edge of layout.edges) {
      expect(edge.y1).toBeLessThan(edge.y2);
    }
  });
});

describe("DependencyGraph", () => {
  function renderInTheme(theme: "dark" | "light"): string {
    return renderToStaticMarkup(
      React.createElement(
        "div",
        { "data-theme": theme },
        React.createElement(DependencyGraph, { model: diamondModel }),
      ),
    );
  }

  it("mounts nodes and distinguishes satisfied vs dashed edges", () => {
    const html = renderInTheme("dark");

    expect((html.match(/data-testid="dep-graph-node"/g) ?? []).length).toBe(4);
    expect((html.match(/data-testid="dep-graph-edge"/g) ?? []).length).toBe(4);
    expect(html).toContain('data-state="in-flight"');
    expect(html).toContain('data-state="merged"');
    expect(html).toContain('data-state="blocked"');

    const edgeTags = html.match(/<path\b[^>]*>/g) ?? [];
    const satisfied = edgeTags.filter((t) => t.includes('data-satisfied="true"'));
    const waiting = edgeTags.filter((t) => t.includes('data-satisfied="false"'));
    expect(satisfied).toHaveLength(2);
    expect(waiting).toHaveLength(2);
    for (const tag of satisfied) {
      expect(tag).toContain('stroke="hsl(var(--rail-lit))"');
      expect(tag).not.toContain("stroke-dasharray");
    }
    for (const tag of waiting) {
      expect(tag).toContain('stroke="hsl(var(--blocked))"');
      expect(tag).toContain('stroke-dasharray="4 4"');
    }
  });

  it("renders with theme tokens under both dark and light", () => {
    for (const theme of ["dark", "light"] as const) {
      const html = renderInTheme(theme);
      expect(html).toContain('data-theme="' + theme + '"');
      expect(html).toContain("hsl(var(--rail-lit))");
      expect(html).toContain("hsl(var(--blocked))");
      expect(html).toContain("hsl(var(--current))");
      expect(html).toContain("hsl(var(--merged))");
      expect(html).toContain("hsl(var(--void))");
    }
  });

  it("wraps nodes in links when nodeHref is set", () => {
    const router = createMemoryRouter(
      [
        {
          path: "/",
          element: React.createElement(DependencyGraph, {
            model: diamondModel,
            nodeHref: (node) => `/epics/${node.id}`,
          }),
        },
      ],
      { initialEntries: ["/"] },
    );
    const html = renderToStaticMarkup(
      React.createElement(RouterProvider, { router }),
    );
    expect(html).toContain('href="/epics/C"');
    expect(html).toContain('href="/epics/D"');
  });
});
