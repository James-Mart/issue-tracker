// @vitest-environment happy-dom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import mermaid from "mermaid";
import { Markdown } from "@/features/issues/components/markdown";
import { TranscriptMarkdownText } from "./transcript-ui";

const FLOW = "flowchart TD\n  A-->B";
const CLOSED = `Before\n\n\`\`\`mermaid\n${FLOW}\n\`\`\`\n\nAfter`;

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

async function settle(assert: () => void) {
  const start = Date.now();
  let last: unknown;
  while (Date.now() - start < 10000) {
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

function diagramSvg(container: ParentNode): SVGElement | null {
  return container.querySelector("[data-mermaid-host] svg");
}

beforeEach(() => {
  document.documentElement.setAttribute("data-theme", "dark");
  vi.spyOn(mermaid, "render").mockImplementation(async () => ({
    svg: diagramMarkup(),
    bindFunctions: vi.fn(),
    diagramType: "flowchart-v2",
  }));
});

afterEach(() => {
  document.body.innerHTML = "";
  document.documentElement.setAttribute("data-theme", "dark");
  vi.restoreAllMocks();
});

describe("mermaid diagram view", () => {
  it("renders an SVG and a source control that shows then hides the fence body", async () => {
    const initialize = vi.spyOn(mermaid, "initialize");
    const { container } = mount(
      <TranscriptMarkdownText text={CLOSED} renderMermaid />,
    );

    await settle(() => {
      expect(diagramSvg(container)).toBeTruthy();
    });

    const svg = diagramSvg(container)!;
    expect(svg.style.pointerEvents).toBe("none");
    expect(svg.style.width).toBe("100%");
    expect(svg.querySelector("a")?.getAttribute("href")).toBeNull();
    expect(svg.querySelector("a")?.style.pointerEvents).toBe("none");
    expect(container.querySelector("[data-mermaid-diagram]")?.className).not.toMatch(
      /overflow-y|max-h-/,
    );
    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        securityLevel: "strict",
        startOnLoad: false,
        theme: "dark",
      }),
    );
    expect(mermaid.render).toHaveBeenCalledWith(expect.any(String), FLOW);

    const button = container.querySelector("button");
    expect(button?.textContent).toContain("Show source");
    expect(container.querySelector("[data-mermaid-source]")).toBeNull();

    act(() => {
      button!.click();
    });
    expect(container.querySelector("[data-mermaid-source]")?.textContent).toContain(FLOW);
    expect(diagramSvg(container)).toBe(svg);
    expect(button?.textContent).toContain("Hide source");

    act(() => {
      button!.click();
    });
    expect(container.querySelector("[data-mermaid-source]")).toBeNull();
    expect(diagramSvg(container)).toBe(svg);
  });

  it("re-renders when the document theme changes", async () => {
    const initialize = vi.spyOn(mermaid, "initialize");
    mount(<Markdown renderMermaid>{CLOSED}</Markdown>);
    await settle(() => {
      expect(initialize).toHaveBeenCalledWith(
        expect.objectContaining({ theme: "dark" }),
      );
    });

    await act(async () => {
      document.documentElement.setAttribute("data-theme", "light");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await settle(() => {
      expect(initialize).toHaveBeenCalledWith(
        expect.objectContaining({ theme: "default" }),
      );
    });
  });

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

  it("attempts an unclosed mermaid fence", async () => {
    const { container } = mount(
      <Markdown renderMermaid>{"```mermaid\n" + FLOW}</Markdown>,
    );
    await settle(() => {
      expect(diagramSvg(container)).toBeTruthy();
    });
    expect(mermaid.render).toHaveBeenCalledWith(expect.any(String), FLOW);
  });

  it("leaves a mermaid fence as a code block when renderMermaid is omitted", () => {
    const { container } = mount(<TranscriptMarkdownText text={CLOSED} />);
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
    expect(mermaid.render).not.toHaveBeenCalled();
    const code = container.querySelector("pre code");
    expect(code?.className).toContain("language-mermaid");
    expect(code?.textContent).toContain("A-->B");
  });

  it("leaves a non-mermaid fence as a code block", () => {
    const { container } = mount(
      <Markdown renderMermaid>{"```ts\nconst n = 1;\n```"}</Markdown>,
    );
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelector("[data-mermaid-diagram]")).toBeNull();
    expect(mermaid.render).not.toHaveBeenCalled();
    expect(container.querySelector("pre code")?.textContent).toContain("const n = 1;");
  });

  it("toggles each fence independently", async () => {
    const text = [
      "```mermaid",
      FLOW,
      "```",
      "",
      "```mermaid",
      "flowchart TD\n  C-->D",
      "```",
    ].join("\n");
    const { container } = mount(<Markdown renderMermaid>{text}</Markdown>);
    await settle(() => {
      expect(container.querySelectorAll("[data-mermaid-host] svg")).toHaveLength(2);
    });
    const buttons = [...container.querySelectorAll("button")];
    expect(buttons).toHaveLength(2);
    act(() => {
      buttons[0]!.click();
    });
    const sources = container.querySelectorAll("[data-mermaid-source]");
    expect(sources).toHaveLength(1);
    expect(sources[0]?.textContent).toContain("A-->B");
    expect(sources[0]?.textContent).not.toContain("C-->D");
    expect(container.querySelectorAll("[data-mermaid-host] svg")).toHaveLength(2);
  });
});
