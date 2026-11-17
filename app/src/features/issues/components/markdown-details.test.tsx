// @vitest-environment happy-dom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Markdown } from "./markdown";

function mount(node: ReactElement): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  mounted.push(root);
  return container;
}

const mounted: Root[] = [];

afterEach(() => {
  act(() => {
    for (const root of mounted) root.unmount();
  });
  mounted.length = 0;
  document.body.innerHTML = "";
});

function detailsOf(container: HTMLElement): HTMLDetailsElement[] {
  return [...container.querySelectorAll("details")];
}

describe("markdown details and summary", () => {
  it("renders a closed disclosure with one arrow and markdown inside", () => {
    const container = mount(
      <Markdown>
        {[
          "Before",
          "",
          "<details>",
          "<summary>Quiet section</summary>",
          "",
          "Hidden **markdown** and `code`.",
          "",
          "- item",
          "",
          "```js",
          "const x = 1",
          "```",
          "",
          "</details>",
          "",
          "After <script>alert(1)</script>",
        ].join("\n")}
      </Markdown>,
    );

    const details = detailsOf(container);
    expect(details).toHaveLength(1);
    expect(details[0]?.open).toBe(false);
    expect(details[0]?.hasAttribute("open")).toBe(false);
    const summary = details[0]?.querySelector("summary");
    expect(summary?.textContent).toContain("Quiet section");
    expect(summary?.querySelectorAll("svg")).toHaveLength(1);
    expect(summary?.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(details[0]?.querySelector("strong")?.textContent).toBe("markdown");
    expect(details[0]?.querySelector("code")?.textContent).toBe("code");
    expect(details[0]?.querySelector("li")?.textContent).toBe("item");
    expect(details[0]?.querySelector("pre")?.textContent).toContain("const x = 1");
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>");
    expect(container.textContent).toContain("Before");
    expect(container.textContent).toContain("After");
  });
});
