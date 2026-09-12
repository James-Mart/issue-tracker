// @vitest-environment happy-dom
import {
  mountThread,
  resetThreadMocks,
  setSelectedConversationId,
  threadUi,
} from "./conversation-thread.test-helpers";
import { act } from "react";
import { type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

describe("ConversationThread read-only fork chrome", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    container = undefined;
    root = undefined;
    resetThreadMocks();
  });

  it("renders read-only badge, source link, and composer notice when meta fields are set", () => {
    threadUi.readOnly = true;
    threadUi.forkedFrom = "conv-source";
    ({ container, root } = mountThread("conv-1"));

    expect(
      container!.querySelector('[data-testid="forked-thread-read-only-badge"]'),
    ).not.toBeNull();
    expect(container!.textContent).toContain("Read only");

    const sourceLink = container!.querySelector(
      '[data-testid="forked-thread-source-link"]',
    );
    expect(sourceLink).not.toBeNull();
    expect(sourceLink!.textContent).toContain("Source conversation");

    expect(
      container!.querySelector('[data-testid="forked-thread-composer-notice"]'),
    ).not.toBeNull();
    expect(container!.textContent).toContain(
      "Read-only fork — explores and answers",
    );
  });

  it("omits fork chrome when meta lacks readOnly and forkedFrom", () => {
    ({ container, root } = mountThread("conv-1"));

    expect(
      container!.querySelector('[data-testid="forked-thread-read-only-badge"]'),
    ).toBeNull();
    expect(
      container!.querySelector('[data-testid="forked-thread-source-link"]'),
    ).toBeNull();
    expect(
      container!.querySelector('[data-testid="forked-thread-composer-notice"]'),
    ).toBeNull();
  });

  it("shows source link only when forkedFrom is set", () => {
    threadUi.forkedFrom = "conv-source";
    ({ container, root } = mountThread("conv-1"));

    expect(
      container!.querySelector('[data-testid="forked-thread-source-link"]'),
    ).not.toBeNull();
    expect(
      container!.querySelector('[data-testid="forked-thread-read-only-badge"]'),
    ).toBeNull();
    expect(
      container!.querySelector('[data-testid="forked-thread-composer-notice"]'),
    ).toBeNull();
  });

  it("shows read-only chrome only when readOnly is set", () => {
    threadUi.readOnly = true;
    ({ container, root } = mountThread("conv-1"));

    expect(
      container!.querySelector('[data-testid="forked-thread-read-only-badge"]'),
    ).not.toBeNull();
    expect(
      container!.querySelector('[data-testid="forked-thread-composer-notice"]'),
    ).not.toBeNull();
    expect(
      container!.querySelector('[data-testid="forked-thread-source-link"]'),
    ).toBeNull();
  });

  it("navigates to the recorded source conversation when the link is activated", () => {
    threadUi.forkedFrom = "conv-source";
    ({ container, root } = mountThread("conv-1"));

    const sourceLink = container!.querySelector(
      '[data-testid="forked-thread-source-link"]',
    ) as HTMLButtonElement;

    act(() => {
      sourceLink.click();
    });

    expect(setSelectedConversationId).toHaveBeenCalledWith("conv-source");
  });

  it("places the read-only badge on the status strip row", () => {
    threadUi.readOnly = true;
    ({ container, root } = mountThread("conv-1", { width: "390px" }));

    const strip = container!.querySelector('[data-testid="thread-status-strip"]');
    expect(strip?.contains(
      container!.querySelector('[data-testid="forked-thread-read-only-badge"]'),
    )).toBe(true);
  });
});
