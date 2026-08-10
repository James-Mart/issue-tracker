import { describe, expect, it } from "vitest";
import {
  SCROLL_PIN_THRESHOLD_PX,
  applyAutoscroll,
  isScrollPinned,
} from "./message-scroller";

function box(
  partial: Partial<{
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
  }>,
) {
  return {
    scrollTop: 0,
    scrollHeight: 400,
    clientHeight: 200,
    ...partial,
  };
}

describe("isScrollPinned", () => {
  it("treats an exact bottom position as pinned", () => {
    expect(
      isScrollPinned(box({ scrollTop: 200, scrollHeight: 400, clientHeight: 200 })),
    ).toBe(true);
  });

  it("stays pinned within the threshold of the bottom", () => {
    const distance = SCROLL_PIN_THRESHOLD_PX - 1;
    expect(
      isScrollPinned(
        box({
          scrollTop: 200 - distance,
          scrollHeight: 400,
          clientHeight: 200,
        }),
      ),
    ).toBe(true);
  });

  it("is unpinned when the reader has scrolled away", () => {
    expect(
      isScrollPinned(box({ scrollTop: 0, scrollHeight: 400, clientHeight: 200 })),
    ).toBe(false);
  });

  it("re-pins when the reader returns to the bottom", () => {
    const scrolledAway = box({
      scrollTop: 40,
      scrollHeight: 400,
      clientHeight: 200,
    });
    expect(isScrollPinned(scrolledAway)).toBe(false);

    const backAtBottom = box({
      scrollTop: 200,
      scrollHeight: 400,
      clientHeight: 200,
    });
    expect(isScrollPinned(backAtBottom)).toBe(true);
  });
});

describe("applyAutoscroll", () => {
  it("scrolls the container to the bottom while pinned", () => {
    const el = box({ scrollTop: 50, scrollHeight: 500, clientHeight: 200 });
    applyAutoscroll(el, true);
    expect(el.scrollTop).toBe(500);
  });

  it("leaves the position untouched when the reader is unpinned", () => {
    const el = box({ scrollTop: 80, scrollHeight: 500, clientHeight: 200 });
    applyAutoscroll(el, false);
    expect(el.scrollTop).toBe(80);
  });

  it("follows new content while pinned, then holds after unpin", () => {
    const el = box({ scrollTop: 200, scrollHeight: 400, clientHeight: 200 });
    expect(isScrollPinned(el)).toBe(true);

    el.scrollHeight = 600;
    applyAutoscroll(el, true);
    expect(el.scrollTop).toBe(600);

    el.scrollTop = 100;
    expect(isScrollPinned(el)).toBe(false);

    el.scrollHeight = 800;
    applyAutoscroll(el, false);
    expect(el.scrollTop).toBe(100);
  });
});
