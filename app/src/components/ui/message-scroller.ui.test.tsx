// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
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

type ScrollerProps = { topKey?: unknown; onReachTop?: () => void };

let container: HTMLDivElement | undefined;
let root: Root | undefined;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  container = undefined;
  root = undefined;
});

/** Mounts into `container` / `root`; the returned render re-renders with new props. */
function mountScroller(props: ScrollerProps = {}) {
  container = document.createElement("div");
  container.style.height = "240px";
  container.style.width = "480px";
  container.style.display = "flex";
  container.style.flexDirection = "column";
  document.body.appendChild(container);
  const mounted = createRoot(container);
  root = mounted;
  const render = (next: ScrollerProps) =>
    act(() => {
      mounted.render(
        <MessageScroller bottomKey={0} {...next}>
          <div data-testid="content" style={{ minHeight: 800 }}>
            Long transcript content
          </div>
        </MessageScroller>,
      );
    });
  render(props);
  return render;
}

describe("MessageScroller jump-to-bottom", () => {
  it("hides the control while pinned at the bottom", () => {
    mountScroller();
    const scroller = scrollerEl(container!);
    mockOverflow(scroller);
    expect(scroller.getAttribute("data-pinned")).toBe("true");
    expect(container!.querySelector('[data-testid="jump-to-bottom"]')).toBeNull();
  });

  it("shows the control after the reader scrolls away", () => {
    mountScroller();
    const scroller = scrollerEl(container!);
    mockOverflow(scroller);
    scrollAway(scroller);

    expect(scroller.getAttribute("data-pinned")).toBe("false");
    expect(container!.querySelector('[data-testid="jump-to-bottom"]')).toBeTruthy();
  });

  it("re-pins and hides the control when activated", () => {
    mountScroller();
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
    mountScroller();
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

describe("MessageScroller top edge", () => {
  function scrollTo(scroller: HTMLDivElement, top: number) {
    scroller.scrollTop = top;
    act(() => {
      scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
  }

  it("keeps the content at the same distance from the bottom when rows land above it", () => {
    const render = mountScroller({ topKey: "idle:0" });
    const scroller = scrollerEl(container!);
    mockOverflow(scroller, 800);
    scrollTo(scroller, 20);

    mockOverflow(scroller, 1400);
    render({ topKey: "idle:12" });

    expect(scroller.scrollTop).toBe(620);
  });

  it("calls onReachTop at the top edge, not further down", () => {
    const onReachTop = vi.fn();
    mountScroller({ topKey: 0, onReachTop });
    const scroller = scrollerEl(container!);
    mockOverflow(scroller, 800);
    onReachTop.mockClear();

    scrollTo(scroller, 400);
    expect(onReachTop).not.toHaveBeenCalled();

    scrollTo(scroller, 10);
    expect(onReachTop).toHaveBeenCalledTimes(1);
  });

  it("calls onReachTop after a render when the content does not fill the viewport", () => {
    const onReachTop = vi.fn();
    mountScroller({ topKey: 0, onReachTop });

    expect(onReachTop).toHaveBeenCalled();
  });
});
