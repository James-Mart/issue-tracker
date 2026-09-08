// @vitest-environment happy-dom
import {
  attachmentStore,
  mountThread,
  refetchHistory,
  renderThread,
  resetThreadMocks,
  threadUi,
  transcriptState,
} from "./conversation-thread.test-helpers";
import { act } from "react";
import { type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

describe("ConversationThread Tool use groups", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    container = undefined;
    root = undefined;
    resetThreadMocks();
  });

  it("folds consecutive ordinary tools into one collapsed Tool use block", () => {
    transcriptState.events = [
      { type: "prompt", text: "Read the files", at: "2026-07-24T00:00:00.000Z" },
      {
        type: "thinking",
        text: "I will read both files.",
        at: "2026-07-24T00:00:01.000Z",
      },
      {
        type: "tool_call",
        callId: "c1",
        name: "Read",
        status: "completed",
        args: { path: "/tmp/a.ts" },
        at: "2026-07-24T00:00:02.000Z",
      },
      {
        type: "tool_call",
        callId: "c2",
        name: "Read",
        status: "completed",
        args: { path: "/tmp/b.ts" },
        at: "2026-07-24T00:00:03.000Z",
      },
      {
        type: "assistant",
        text: "Both files are in.",
        at: "2026-07-24T00:00:04.000Z",
      },
    ];
    ({ container, root } = mountThread("conv-1"));

    const groups = container!.querySelectorAll('[data-event="tool_use_group"]');
    expect(groups).toHaveLength(1);
    const group = groups[0] as HTMLDetailsElement;
    expect(group.open).toBe(false);
    expect(group.getAttribute("data-tool-count")).toBe("2");
    expect(group.getAttribute("data-status")).toBe("completed");
    expect(group.querySelector("summary")!.textContent).toContain("Tool use");
    expect(group.querySelector("summary")!.textContent).toContain("2");
    expect(group.querySelector("summary")!.textContent).toContain("Read");
    expect(group.querySelector("summary")!.textContent).toContain("b.ts");

    const thinking = container!.querySelector('[data-event="thinking"]');
    expect(thinking).toBeTruthy();
    expect(thinking!.closest('[data-event="tool_use_group"]')).toBeNull();

    const assistant = container!.querySelector('[data-event="assistant"]');
    expect(assistant).toBeTruthy();
    expect(assistant!.textContent).toContain("Both files are in.");

    act(() => {
      (group.querySelector("summary") as HTMLElement).click();
    });
    expect(group.open).toBe(true);
    expect(group.querySelector("[data-call-id='c1']")).toBeTruthy();
    expect(group.querySelector("[data-call-id='c2']")).toBeTruthy();
  });

  it("keeps the group collapsed and updates the live hint as tools progress", () => {
    transcriptState.events = [
      { type: "prompt", text: "Run tools", at: "2026-07-24T00:00:00.000Z" },
      {
        type: "tool_call",
        callId: "c1",
        name: "Read",
        status: "completed",
        args: { path: "/tmp/a.ts" },
        at: "2026-07-24T00:00:01.000Z",
      },
      {
        type: "tool_call",
        callId: "c2",
        name: "Grep",
        status: "running",
        args: { pattern: "foo", glob: "*.ts" },
        at: "2026-07-24T00:00:02.000Z",
      },
    ];
    ({ container, root } = mountThread("conv-1"));

    const group = container!.querySelector(
      '[data-event="tool_use_group"]',
    ) as HTMLDetailsElement;
    expect(group.open).toBe(false);
    expect(group.getAttribute("data-status")).toBe("running");
    const summary = () => group.querySelector("summary")!.textContent ?? "";
    expect(summary()).toContain("Grep");
    expect(summary()).toContain("foo in *.ts");

    transcriptState.events = [
      ...transcriptState.events.slice(0, 2),
      {
        type: "tool_call",
        callId: "c2",
        name: "Grep",
        status: "completed",
        args: { pattern: "foo", glob: "*.ts" },
        at: "2026-07-24T00:00:02.000Z",
      },
      {
        type: "tool_call",
        callId: "c3",
        name: "Shell",
        status: "running",
        args: { command: "npm test" },
        at: "2026-07-24T00:00:03.000Z",
      },
    ];
    renderThread(root!, "conv-1");

    expect(group.open).toBe(false);
    expect(group.getAttribute("data-status")).toBe("running");
    expect(summary()).toContain("Shell");
    expect(summary()).toContain("npm test");
    expect(summary()).not.toContain("Grep");

    transcriptState.events = transcriptState.events.map((event) =>
      event.type === "tool_call" && event.callId === "c3"
        ? { ...event, status: "completed" as const }
        : event,
    );
    renderThread(root!, "conv-1");

    expect(group.open).toBe(false);
    expect(group.getAttribute("data-status")).toBe("completed");
    expect(summary()).toContain("Shell");
    expect(summary()).toContain("npm test");
  });

  it("auto-expands the group and errored tool row while siblings stay collapsed", () => {
    transcriptState.events = [
      { type: "prompt", text: "Run tools", at: "2026-07-24T00:00:00.000Z" },
      {
        type: "tool_call",
        callId: "c1",
        name: "Read",
        status: "completed",
        args: { path: "/tmp/a.ts" },
        result: "file contents",
        at: "2026-07-24T00:00:01.000Z",
      },
      {
        type: "tool_call",
        callId: "c2",
        name: "Shell",
        status: "error",
        args: { command: "npm test" },
        result: "Command failed with exit code 1",
        at: "2026-07-24T00:00:02.000Z",
      },
      {
        type: "tool_call",
        callId: "c3",
        name: "Grep",
        status: "completed",
        args: { pattern: "foo" },
        result: "no matches",
        at: "2026-07-24T00:00:03.000Z",
      },
    ];
    ({ container, root } = mountThread("conv-1"));

    const group = container!.querySelector(
      '[data-event="tool_use_group"]',
    ) as HTMLDetailsElement;
    expect(group.open).toBe(true);
    expect(group.getAttribute("data-status")).toBe("error");
    expect(group.querySelector("summary")!.textContent).toContain("error");

    const errored = group.querySelector(
      "[data-call-id='c2']",
    ) as HTMLDetailsElement;
    expect(errored.open).toBe(true);
    expect(group.textContent).toContain("Command failed with exit code 1");

    const completed = group.querySelector(
      "[data-call-id='c1']",
    ) as HTMLDetailsElement;
    expect(completed.open).toBe(false);
    expect(group.querySelector("[data-call-id='c1'] summary")!.textContent).not.toContain(
      "file contents",
    );

    const sibling = group.querySelector(
      "[data-call-id='c3']",
    ) as HTMLDetailsElement;
    expect(sibling.open).toBe(false);
    expect(group.querySelector("[data-call-id='c3'] summary")!.textContent).not.toContain(
      "no matches",
    );
  });
});

describe("ConversationThread transcript load failure", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    container = undefined;
    root = undefined;
    resetThreadMocks();
  });

  it("shows retry rather than skeletons over painted events when a seeded refetch fails", () => {
    threadUi.ready = true;
    threadUi.historyFailed = true;
    ({ container, root } = mountThread("conv-1"));

    expect(container!.querySelector('[aria-busy="true"]')).toBeNull();
    expect(
      container!.querySelector('[data-testid="transcript-retry"]'),
    ).toBeTruthy();
    expect(container!.textContent).not.toContain("First turn");
  });

  it("shows failed/retry UI instead of loading skeletons when historyFailed", () => {
    threadUi.ready = false;
    threadUi.historyFailed = true;
    threadUi.historyErrorMessage = "Request timed out";
    ({ container, root } = mountThread("conv-1"));

    expect(container!.querySelector('[aria-busy="true"]')).toBeNull();
    expect(
      container!.querySelector('[data-testid="transcript-retry"]'),
    ).toBeTruthy();
    expect(container!.textContent).toContain("Could not load the transcript.");
    expect(container!.textContent).toContain("Request timed out");
  });

  it("keeps the loading skeleton while pending and not failed", () => {
    threadUi.ready = false;
    threadUi.historyFailed = false;
    ({ container, root } = mountThread("conv-1"));

    expect(container!.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(
      container!.querySelector('[data-testid="transcript-retry"]'),
    ).toBeNull();
  });

  it("calls refetchHistory when retry is activated", () => {
    threadUi.ready = false;
    threadUi.historyFailed = true;
    ({ container, root } = mountThread("conv-1"));

    act(() => {
      (
        container!.querySelector(
          '[data-testid="transcript-retry"]',
        ) as HTMLButtonElement
      ).click();
    });

    expect(refetchHistory).toHaveBeenCalledTimes(1);
  });

  it("disables retry while a refetch is in flight", () => {
    threadUi.ready = false;
    threadUi.historyFailed = true;
    threadUi.isRefetchingHistory = true;
    ({ container, root } = mountThread("conv-1"));

    expect(
      (
        container!.querySelector(
          '[data-testid="transcript-retry"]',
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("keeps inline error transcript events as error cards, not the failed state", () => {
    threadUi.ready = true;
    threadUi.historyFailed = false;
    transcriptState.events = [
      {
        type: "error",
        message: "Agent stream failed",
        at: "2026-07-24T00:00:00.000Z",
      },
    ];
    ({ container, root } = mountThread("conv-1"));

    expect(
      container!.querySelector('[data-testid="transcript-retry"]'),
    ).toBeNull();
    expect(container!.querySelector('[data-event="error"]')).toBeTruthy();
    expect(container!.textContent).toContain("Agent stream failed");
    expect(container!.textContent).toContain("Send failed");
  });

  it("shows the empty state after a successful load with no events", () => {
    threadUi.ready = true;
    threadUi.historyFailed = false;
    transcriptState.events = [];
    ({ container, root } = mountThread("conv-1"));

    expect(container!.textContent).toContain("No transcript yet.");
    expect(
      container!.querySelector('[data-testid="transcript-retry"]'),
    ).toBeNull();
    expect(container!.querySelector('[aria-busy="true"]')).toBeNull();
  });
});

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
