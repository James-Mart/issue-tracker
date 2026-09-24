// @vitest-environment happy-dom
import {
  mountThread,
  resetThreadMocks,
  navigate,
  threadUi,
} from "./conversation-thread.test-helpers";
import { act } from "react";
import { type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

describe("ConversationThread stored readOnly fork chrome", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    container = undefined;
    root = undefined;
    resetThreadMocks();
  });

  it("omits read-only badge and composer notice when stored readOnly is set", () => {
    threadUi.readOnly = true;
    threadUi.forkedFrom = "conv-source";
    ({ container, root } = mountThread("conv-1"));

    expect(
      container!.querySelector('[data-testid="forked-thread-read-only-badge"]'),
    ).toBeNull();
    expect(
      container!.querySelector('[data-testid="forked-thread-composer-notice"]'),
    ).toBeNull();
    expect(container!.textContent).not.toContain("Read only");
    expect(container!.textContent).not.toContain(
      "Read-only fork — explores and answers",
    );
  });

  it("still renders the source link when forkedFrom is set", () => {
    threadUi.readOnly = true;
    threadUi.forkedFrom = "conv-source";
    ({ container, root } = mountThread("conv-1"));

    const sourceLink = container!.querySelector(
      '[data-testid="forked-thread-source-link"]',
    );
    expect(sourceLink).not.toBeNull();
    expect(sourceLink!.textContent).toContain("Source conversation");
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

  it("navigates to the recorded source conversation when the link is activated", () => {
    threadUi.forkedFrom = "conv-source";
    ({ container, root } = mountThread("conv-1"));

    const sourceLink = container!.querySelector(
      '[data-testid="forked-thread-source-link"]',
    ) as HTMLButtonElement;

    act(() => {
      sourceLink.click();
    });

    expect(navigate).toHaveBeenCalledWith("/agents/conv-source");
  });
});
