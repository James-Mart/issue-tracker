// @vitest-environment happy-dom
import {
  mountThread,
  resetThreadMocks,
  threadUi,
  transcriptState,
} from "./conversation-thread.test-helpers";
import { act } from "react";
import { type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

function forkPointMarkers(container: ParentNode): HTMLElement[] {
  return [...container.querySelectorAll('[data-testid="fork-point-inline-marker"]')];
}

function transcriptLandmarks(container: ParentNode): HTMLElement[] {
  return [
    ...container.querySelectorAll(
      '[data-event], [data-testid="fork-point-inline-marker"]',
    ),
  ];
}

describe("ConversationThread fork-point inline marker", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    container = undefined;
    root = undefined;
    resetThreadMocks();
  });

  it("renders one marker after forkedAtSeq when meta carries forkedAtSeq", () => {
    threadUi.forkedFrom = "conv-source";
    threadUi.forkedAtSeq = 2;
    ({ container, root } = mountThread("conv-1"));

    const markers = forkPointMarkers(container!);
    expect(markers).toHaveLength(1);
    expect(markers[0]!.textContent).toContain("History above was inherited");
    expect(markers[0]!.textContent).toContain(
      "messages below are this conversation's own",
    );

    const landmarks = transcriptLandmarks(container!);
    const markerIndex = landmarks.findIndex((node) =>
      node.matches('[data-testid="fork-point-inline-marker"]'),
    );
    expect(markerIndex).toBeGreaterThan(-1);
    expect(landmarks[markerIndex - 1]?.getAttribute("data-event")).toBe(
      "assistant",
    );
    expect(landmarks[markerIndex + 1]?.getAttribute("data-event")).toBe(
      "prompt",
    );
  });

  it("omits the marker when forkedAtSeq is absent", () => {
    ({ container, root } = mountThread("conv-1"));

    expect(forkPointMarkers(container!)).toHaveLength(0);
  });

  it("places the marker after trailing usage when forkedAtSeq points at usage", () => {
    threadUi.forkedFrom = "conv-source";
    threadUi.forkedAtSeq = 3;
    transcriptState.events = [
      {
        type: "prompt",
        text: "First turn",
        at: "2026-07-24T00:00:00.000Z",
        seq: 1,
      },
      {
        type: "assistant",
        text: "First reply",
        at: "2026-07-24T00:00:01.000Z",
        seq: 2,
      },
      {
        type: "usage",
        at: "2026-07-24T00:00:02.000Z",
        seq: 3,
        usage: {
          totalTokens: 4,
          inputTokens: 3,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      },
      {
        type: "prompt",
        text: "Forked turn",
        at: "2026-07-24T00:00:03.000Z",
        seq: 4,
      },
      {
        type: "assistant",
        text: "Forked reply",
        at: "2026-07-24T00:00:04.000Z",
        seq: 5,
      },
    ];
    ({ container, root } = mountThread("conv-1"));

    expect(forkPointMarkers(container!)).toHaveLength(1);

    const landmarks = transcriptLandmarks(container!);
    const markerIndex = landmarks.findIndex((node) =>
      node.matches('[data-testid="fork-point-inline-marker"]'),
    );
    expect(markerIndex).toBeGreaterThan(-1);
    expect(landmarks[markerIndex - 1]?.getAttribute("data-event")).toBe(
      "assistant",
    );
    expect(landmarks[markerIndex + 1]?.getAttribute("data-event")).toBe(
      "prompt",
    );
    expect(landmarks[markerIndex + 1]?.textContent).toContain("Forked turn");
  });
});
