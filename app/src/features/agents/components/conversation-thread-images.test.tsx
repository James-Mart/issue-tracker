// @vitest-environment happy-dom
import {
  mountThread,
  resetThreadMocks,
  transcriptState,
} from "./conversation-thread.test-helpers";
import { act } from "react";
import { type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

describe("ConversationThread attachment images", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    container = undefined;
    root = undefined;
    resetThreadMocks();
  });

  it("renders an attachment image and opens the zoom view", () => {
    const src = "/api/issues/demo-issue/attachments/shot.png";
    transcriptState.events = [
      {
        type: "assistant",
        text: `Here is the capture:\n\n![shot.png](${src})`,
        at: "2026-07-24T00:00:01.000Z",
      },
    ];
    ({ container, root } = mountThread("conv-1"));

    const img = container!.querySelector(`img[src="${src}"]`);
    expect(img).toBeTruthy();

    act(() => {
      (
        container!.querySelector("[data-markdown-image]") as HTMLButtonElement
      ).click();
    });

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog!.querySelector(`img[src="${src}"]`)).toBeTruthy();
  });

  it("lays captures in one column with per-image captions at 390px", () => {
    const states = ["empty", "hover", "disabled"] as const;
    const images = states
      .map(
        (state) =>
          `![${state}](/api/issues/demo-issue/attachments/${state}.png)`,
      )
      .join("\n\n");
    transcriptState.events = [
      {
        type: "assistant",
        text: `Captures:\n\n${images}`,
        at: "2026-07-24T00:00:01.000Z",
      },
    ];
    ({ container, root } = mountThread("conv-1", { width: "390px" }));

    const gallery = container!.querySelector("[data-capture-gallery]");
    expect(gallery).toBeTruthy();
    const figures = [...gallery!.children].filter(
      (el) => el.tagName === "FIGURE",
    );
    expect(figures).toHaveLength(states.length);
    expect(gallery!.classList.contains("issue-md-gallery")).toBe(true);
    const captions = [...gallery!.querySelectorAll("figcaption")].map(
      (el) => el.textContent,
    );
    expect(captions).toEqual([...states]);
    for (const img of gallery!.querySelectorAll("img")) {
      expect(img.classList.contains("issue-md-image")).toBe(true);
    }
    expect(container!.scrollWidth).toBeLessThanOrEqual(390);
  });
});
