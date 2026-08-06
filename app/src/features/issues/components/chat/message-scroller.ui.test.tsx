// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { isScrollPinned, MessageScroller } from "./message-scroller";

function mockOverflow(scroller: HTMLDivElement, scrollHeight = 800) {
  Object.defineProperty(scroller, "scrollHeight", {
    configurable: true,
    value: scrollHeight,
  });
  Object.defineProperty(scroller, "clientHeight", {
    configurable: true,
    value: 240,
  });
}

function scrollerEl(container: ParentNode): HTMLDivElement {
  const el = container.querySelector('[data-pinned]');
  expect(el).toBeTruthy();
  return el as HTMLDivElement;
}

function scrollAway(scroller: HTMLDivElement) {
  scroller.scrollTop = 0;
  act(() => {
    scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
}

function mountScroller(bottomKey: unknown = 0): {
  container: HTMLDivElement;
  root: Root;
} {
  const container = document.createElement("div");
  container.style.height = "240px";
  container.style.width = "480px";
  container.style.display = "flex";
  container.style.flexDirection = "column";
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <MessageScroller bottomKey={bottomKey}>
        <div data-testid="content" style={{ minHeight: 800 }}>
          Long transcript content
        </div>
      </MessageScroller>,
    );
  });
  return { container, root };
}

describe("MessageScroller jump-to-bottom", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    container = undefined;
    root = undefined;
  });

  it("hides the control while pinned at the bottom", () => {
    ({ container, root } = mountScroller());
    const scroller = scrollerEl(container!);
    mockOverflow(scroller);
    expect(scroller.getAttribute("data-pinned")).toBe("true");
    expect(container!.querySelector('[data-testid="jump-to-bottom"]')).toBeNull();
  });

  it("shows the control after the reader scrolls away", () => {
    ({ container, root } = mountScroller());
    const scroller = scrollerEl(container!);
    mockOverflow(scroller);
    scrollAway(scroller);

    expect(scroller.getAttribute("data-pinned")).toBe("false");
    expect(container!.querySelector('[data-testid="jump-to-bottom"]')).toBeTruthy();
  });

  it("re-pins and hides the control when activated", () => {
    ({ container, root } = mountScroller());
    const scroller = scrollerEl(container!);
    mockOverflow(scroller);
    scrollAway(scroller);

    const button = container!.querySelector(
      '[data-testid="jump-to-bottom"]',
    ) as HTMLButtonElement;
    act(() => {
      button.click();
    });

    expect(scroller.scrollTop).toBe(800);
    expect(isScrollPinned(scroller)).toBe(true);
    expect(scroller.getAttribute("data-pinned")).toBe("true");
    expect(container!.querySelector('[data-testid="jump-to-bottom"]')).toBeNull();
  });

  it("hides the control when the reader scrolls back to the bottom", () => {
    ({ container, root } = mountScroller());
    const scroller = scrollerEl(container!);
    mockOverflow(scroller);
    scrollAway(scroller);
    expect(container!.querySelector('[data-testid="jump-to-bottom"]')).toBeTruthy();

    scroller.scrollTop = 800;
    act(() => {
      scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    });

    expect(scroller.getAttribute("data-pinned")).toBe("true");
    expect(container!.querySelector('[data-testid="jump-to-bottom"]')).toBeNull();
  });
});
