// @vitest-environment happy-dom
import {
  mountThread,
  renderThread,
  resetThreadMocks,
} from "./conversation-thread.test-helpers";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

describe("ConversationThread anchored meta", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    container = undefined;
    root = undefined;
    resetThreadMocks();
  });

  it("mounts the composer from meta when the id is absent from the Agents roster", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    renderThread(root, "anchored-1", {
      meta: { title: "Plan capture", model: "composer-2.5" },
    });
    const composer = container.querySelector(
      '[data-testid="conversation-composer"]',
    );
    expect(composer?.getAttribute("data-model")).toBe("composer-2.5");
    expect(container.textContent).toContain("Plan capture");
  });

  it("omits the composer when hideComposer is set for archived history", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    renderThread(root, "anchored-archived", {
      meta: { title: "Old plan", model: "composer-2.5" },
      hideComposer: true,
    });
    expect(
      container.querySelector('[data-testid="conversation-composer"]'),
    ).toBeNull();
    expect(container.textContent).toContain("Old plan");
  });
});
