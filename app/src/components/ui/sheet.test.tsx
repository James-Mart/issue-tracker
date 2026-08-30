// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Sheet, SheetContent } from "./sheet";

function mountSheet(
  contentProps: React.ComponentProps<typeof SheetContent> = {},
): Root {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <Sheet open>
        <SheetContent {...contentProps}>
          <p>Panel body</p>
        </SheetContent>
      </Sheet>,
    );
  });
  return root;
}

function sheetContent(): HTMLElement {
  const content = document.body.querySelector('[role="dialog"]');
  expect(content).toBeTruthy();
  return content as HTMLElement;
}

function closeControls(): HTMLButtonElement[] {
  return Array.from(
    sheetContent().querySelectorAll("button"),
  ) as HTMLButtonElement[];
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("SheetContent dismissAffordance", () => {
  it("renders the corner close control by default", () => {
    mountSheet({ side: "right" });
    const content = sheetContent();
    const [close] = closeControls();

    expect(close.className).toMatch(/\babsolute\b/);
    expect(close.className).toMatch(/\bright-4\b/);
    expect(close.className).toMatch(/\btop-4\b/);
    expect(close.querySelector("svg")).toBeTruthy();
    expect(content.textContent).toContain("Close");
    expect(content.textContent).toContain("Panel body");
  });

  it("renders a bottom handle close control without the corner X", () => {
    mountSheet({ side: "top", dismissAffordance: "bottom-handle" });
    const content = sheetContent();
    const [close] = closeControls();

    expect(content.className).toMatch(/\bp-0\b/);
    expect(content.className).toMatch(/\bgap-0\b/);
    expect(content.querySelector("svg")).toBeNull();
    expect(close.className).toMatch(/\bmt-auto\b/);
    expect(close.className).toMatch(/\bw-full\b/);
    expect(close.className).toMatch(/\bborder-t\b/);
    expect(close.querySelector('[aria-hidden]')?.className).toMatch(/\bw-11\b/);
    expect(close.querySelector('[aria-hidden]')?.className).toMatch(
      /\bh-\[0\.3125rem\]/,
    );
    expect(close.textContent).toContain("Close");
    expect(content.textContent).toContain("Panel body");
  });
});
