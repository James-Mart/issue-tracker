// @vitest-environment happy-dom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Markdown } from "./markdown";

function mount(
  node: ReactElement,
  widthPx?: number,
): {
  container: HTMLDivElement;
  root: Root;
} {
  const container = document.createElement("div");
  if (widthPx !== undefined) {
    container.style.width = `${widthPx}px`;
  }
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return { container, root };
}

const mounted: { root: Root; container: HTMLDivElement }[] = [];

afterEach(() => {
  while (mounted.length > 0) {
    const { root, container } = mounted.pop()!;
    act(() => {
      root.unmount();
    });
    container.remove();
  }
});

function renderMarkdown(text: string, widthPx?: number): HTMLDivElement {
  const { container, root } = mount(<Markdown>{text}</Markdown>, widthPx);
  mounted.push({ root, container });
  return container;
}

describe("Markdown", () => {
  it("keeps newlines, blank lines, and indentation in a bare fence", () => {
    const body = ["line1", "", "  indented", "line3"].join("\n");
    const container = renderMarkdown(
      ["before", "", "```", body, "```", "", "after"].join("\n"),
    );
    const pre = container.querySelector("pre.issue-md-pre");
    expect(pre).not.toBeNull();
    const code = pre!.querySelector("code");
    expect(code?.textContent?.replace(/\n$/, "")).toBe(body);
  });

  it("still renders single-backtick spans as paragraph inline code", () => {
    const container = renderMarkdown("Use `npm test` here.");
    expect(container.querySelector("p > code")?.textContent).toBe("npm test");
    expect(container.querySelector("pre")).toBeNull();
  });

  describe("fenced code blocks", () => {
    const wide = "w".repeat(400);

    it.each([
      ["bare", ["```", wide, "```"].join("\n"), null] as const,
      [
        "language-tagged",
        ["```typescript", wide, "```"].join("\n"),
        "language-typescript",
      ] as const,
    ])(
      "keeps a long %s fence line inside a 390px column",
      (_label, markdown, languageClass) => {
        const shell = renderMarkdown(markdown, 390);
        expect(shell.scrollWidth).toBeLessThanOrEqual(390);
        const pre = shell.querySelector("pre.issue-md-pre");
        expect(pre?.textContent).toContain(wide);
        const code = pre?.querySelector("code");
        expect(code).not.toBeNull();
        if (languageClass === null) {
          expect(code!.classList.length).toBe(0);
        } else {
          expect(code!.classList.contains(languageClass)).toBe(true);
          expect(code!.classList.length).toBe(1);
        }
      },
    );
  });
});
