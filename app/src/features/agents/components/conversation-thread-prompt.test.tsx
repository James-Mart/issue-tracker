// @vitest-environment happy-dom
import {
  attachmentStore,
  mountThread,
  resetThreadMocks,
  transcriptState,
} from "./conversation-thread.test-helpers";
import { act } from "react";
import { type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

describe("ConversationThread prompt attachments", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    container = undefined;
    root = undefined;
    resetThreadMocks();
  });

  it("renders image attachment thumbnails at the conversation attachment path", () => {
    attachmentStore.attachments = [
      { name: "shot.png", size: 2048, mimeType: "image/png" },
    ];
    transcriptState.events = [
      {
        type: "prompt",
        text: "See this",
        attachments: ["shot.png"],
        at: "2026-07-24T00:00:00.000Z",
      },
    ];
    ({ container, root } = mountThread("conv-1"));

    const src = "/api/conversations/conv-1/attachments/shot.png";
    const img = container!.querySelector(`img[src="${src}"]`);
    expect(img).toBeTruthy();
    expect(
      container!.querySelector('[data-prompt-attachment-image="shot.png"]'),
    ).toBeTruthy();
  });

  it("renders a non-image attachment as a download row", () => {
    attachmentStore.attachments = [
      { name: "notes.txt", size: 4096, mimeType: "text/plain" },
    ];
    transcriptState.events = [
      {
        type: "prompt",
        text: "Review this log",
        attachments: ["notes.txt"],
        at: "2026-07-24T00:00:00.000Z",
      },
    ];
    ({ container, root } = mountThread("conv-1"));

    const row = container!.querySelector(
      '[data-prompt-attachment-file="notes.txt"]',
    );
    expect(row).toBeTruthy();
    expect(row!.textContent).toContain("notes.txt");
    expect(row!.textContent).toContain("4.0 KB");
    const link = row!.querySelector(
      'a[href="/api/conversations/conv-1/attachments/notes.txt"]',
    );
    expect(link).toBeTruthy();
    expect(link!.getAttribute("download")).toBe("notes.txt");
  });

  it("renders a missing attachment as a plain filename row", () => {
    attachmentStore.attachments = [];
    transcriptState.events = [
      {
        type: "prompt",
        text: "Where did it go?",
        attachments: ["gone.pdf"],
        at: "2026-07-24T00:00:00.000Z",
      },
    ];
    ({ container, root } = mountThread("conv-1"));

    const row = container!.querySelector(
      '[data-prompt-attachment-missing="gone.pdf"]',
    );
    expect(row).toBeTruthy();
    expect(row!.textContent).toContain("gone.pdf");
    expect(row!.querySelector("a")).toBeNull();
    expect(row!.querySelector("img")).toBeNull();
  });

  it("leaves a prompt without attachments unchanged", () => {
    attachmentStore.attachments = [];
    transcriptState.events = [
      {
        type: "prompt",
        text: "Plain message",
        at: "2026-07-24T00:00:00.000Z",
      },
    ];
    ({ container, root } = mountThread("conv-1"));

    const prompt = container!.querySelector('[data-event="prompt"]');
    expect(prompt!.textContent).toContain("Plain message");
    expect(
      container!.querySelector("[data-prompt-attachment-image]"),
    ).toBeNull();
    expect(
      container!.querySelector("[data-prompt-attachment-file]"),
    ).toBeNull();
    expect(
      container!.querySelector("[data-prompt-attachment-missing]"),
    ).toBeNull();
  });

  it("shows loading skeletons instead of missing rows while attachments load", () => {
    attachmentStore.isLoading = true;
    attachmentStore.attachments = [];
    transcriptState.events = [
      {
        type: "prompt",
        text: "See this",
        attachments: ["shot.png", "notes.txt"],
        at: "2026-07-24T00:00:00.000Z",
      },
    ];
    ({ container, root } = mountThread("conv-1"));

    expect(
      container!.querySelector('[data-testid="prompt-attachments-loading"]'),
    ).toBeTruthy();
    expect(
      container!.querySelector('[data-prompt-attachment-missing="shot.png"]'),
    ).toBeNull();
    expect(
      container!.querySelector('[data-prompt-attachment-image="shot.png"]'),
    ).toBeNull();
  });
});
