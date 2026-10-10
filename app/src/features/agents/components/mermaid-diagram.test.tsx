// @vitest-environment happy-dom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import mermaid from "mermaid";
import { Markdown } from "@/features/issues/components/markdown";

const FLOW = "flowchart TD\n  A-->B";

function diagramMarkup(): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80" viewBox="0 0 200 80">`,
    `<a href="https://example.com"><text>node</text></a>`,
    `</svg>`,
  ].join("");
}

function mount(node: ReactElement): {
  container: HTMLDivElement;
  root: Root;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return { container, root };
}

// Must give up before the test timeout: an abandoned loop keeps an async
// act() scope open and swallows the next test's synchronous renders.
async function settle(assert: () => void) {
  const start = Date.now();
  let last: unknown;
  while (Date.now() - start < 3000) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    try {
      assert();
      return;
    } catch (error) {
      last = error;
    }
  }
  throw last;
}

beforeEach(() => {
  vi.spyOn(mermaid, "render").mockImplementation(async () => ({
    svg: diagramMarkup(),
    bindFunctions: vi.fn(),
    diagramType: "flowchart-v2",
  }));
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("mermaid diagram view", () => {
  it("shows the parser error and the source when render throws, with no SVG", async () => {
    vi.mocked(mermaid.render).mockRejectedValue(
      new Error("Parse error on line 4: expected ']' before end of diagram."),
    );
    const { container } = mount(
      <Markdown renderMermaid>{`\`\`\`mermaid\n${FLOW}\n\`\`\``}</Markdown>,
    );
    await settle(() => {
      expect(container.querySelector("[data-mermaid-error]")).toBeTruthy();
    });
    expect(container.querySelector("[data-mermaid-error]")?.textContent).toContain(
      "Parse error on line 4: expected ']' before end of diagram.",
    );
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelector("figure")).toBeNull();
    expect(container.querySelector("[data-mermaid-source]")?.textContent).toContain(FLOW);
    expect(container.querySelector("button")).toBeNull();
  });
});
