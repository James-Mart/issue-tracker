// @vitest-environment happy-dom
import { useEffect } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { keyboardInsetPx, useKeyboardInset } from "./use-keyboard-inset";

describe("keyboardInsetPx", () => {
  it("is zero while the visible band fills the layout viewport", () => {
    expect(
      keyboardInsetPx({
        layoutHeight: 800,
        viewportHeight: 800,
        offsetTop: 0,
        scale: 1,
      }),
    ).toBe(0);
  });

  it("reports the covered height when the keyboard shrinks the band", () => {
    expect(
      keyboardInsetPx({
        layoutHeight: 800,
        viewportHeight: 480,
        offsetTop: 0,
        scale: 1,
      }),
    ).toBe(320);
  });

  it("follows the band when the browser scrolls it to the focused field", () => {
    expect(
      keyboardInsetPx({
        layoutHeight: 800,
        viewportHeight: 480,
        offsetTop: 120,
        scale: 1,
      }),
    ).toBe(200);
  });

  it("rounds fractional viewport heights", () => {
    expect(
      keyboardInsetPx({
        layoutHeight: 800,
        viewportHeight: 479.6,
        offsetTop: 0,
        scale: 1,
      }),
    ).toBe(320);
  });

  it("ignores a gap too small to be a keyboard", () => {
    expect(
      keyboardInsetPx({
        layoutHeight: 800,
        viewportHeight: 790,
        offsetTop: 0,
        scale: 1,
      }),
    ).toBe(0);
  });

  it("ignores the shrunken band while pinch-zoomed", () => {
    expect(
      keyboardInsetPx({
        layoutHeight: 800,
        viewportHeight: 400,
        offsetTop: 0,
        scale: 2,
      }),
    ).toBe(0);
  });
});

type FakeViewport = {
  setBand(next: { height: number; offsetTop?: number }): void;
  subscribedEvents(): string[];
};

function mockVisualViewport(height: number): FakeViewport {
  const state = { height, offsetTop: 0, scale: 1 };
  const listeners: { event: string; cb: () => void }[] = [];
  const viewport = {
    get height() {
      return state.height;
    },
    get offsetTop() {
      return state.offsetTop;
    },
    get scale() {
      return state.scale;
    },
    addEventListener: (event: string, cb: () => void) => {
      listeners.push({ event, cb });
    },
    removeEventListener: (event: string, cb: () => void) => {
      const at = listeners.findIndex(
        (entry) => entry.event === event && entry.cb === cb,
      );
      listeners.splice(at, 1);
    },
  };
  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    value: viewport as unknown as VisualViewport,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: height,
  });

  return {
    setBand(next) {
      state.height = next.height;
      state.offsetTop = next.offsetTop ?? 0;
      for (const entry of [...listeners]) entry.cb();
    },
    subscribedEvents: () => listeners.map((entry) => entry.event),
  };
}

function mountProbe(onValue: (value: number) => void): {
  container: HTMLDivElement;
  root: Root;
} {
  function Probe() {
    const inset = useKeyboardInset();
    useEffect(() => {
      onValue(inset);
    }, [inset]);
    return null;
  }

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<Probe />);
  });
  return { container, root };
}

describe("useKeyboardInset", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    container = undefined;
    root = undefined;
    Reflect.deleteProperty(window, "visualViewport");
  });

  it("starts at zero with no keyboard up", () => {
    mockVisualViewport(800);
    const values: number[] = [];
    ({ container, root } = mountProbe((value) => values.push(value)));

    expect(values.at(-1)).toBe(0);
  });

  it("reports the inset when the keyboard opens and again when it closes", () => {
    const viewport = mockVisualViewport(800);
    const values: number[] = [];
    ({ container, root } = mountProbe((value) => values.push(value)));

    act(() => {
      viewport.setBand({ height: 480 });
    });
    expect(values.at(-1)).toBe(320);

    act(() => {
      viewport.setBand({ height: 800 });
    });
    expect(values.at(-1)).toBe(0);
  });

  it("follows the band as the browser scrolls it under the keyboard", () => {
    const viewport = mockVisualViewport(800);
    const values: number[] = [];
    ({ container, root } = mountProbe((value) => values.push(value)));

    act(() => {
      viewport.setBand({ height: 480, offsetTop: 120 });
    });

    expect(values.at(-1)).toBe(200);
  });

  it("drops its viewport listeners on unmount", () => {
    const viewport = mockVisualViewport(800);
    ({ container, root } = mountProbe(() => {}));
    expect(viewport.subscribedEvents()).toEqual(["resize", "scroll"]);

    act(() => root!.unmount());
    root = undefined;

    expect(viewport.subscribedEvents()).toEqual([]);
  });
});
