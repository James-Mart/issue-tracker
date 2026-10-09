// @vitest-environment happy-dom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Markdown } from "./markdown";

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

function renderMarkdown(text: string): HTMLDivElement {
  const { container, root } = mount(<Markdown>{text}</Markdown>);
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
});
