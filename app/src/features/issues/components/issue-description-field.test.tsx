// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IssueDetail } from "@server/schemas";
import { IssueDescriptionField } from "./issue-description-field";
import { descriptionDraftStorageKey } from "../lib/description-draft-storage";

vi.mock("../api/mutations", () => ({
  useUpdateIssue: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/features/agents/api/queries", () => ({
  useTranscriptionCapabilityQuery: () => ({
    data: { available: true },
    isLoading: false,
    isError: false,
  }),
}));

vi.mock("@/features/agents/hooks/use-voice-recording", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("@/features/agents/hooks/use-voice-recording")
    >();
  return {
    ...original,
    useVoiceRecording: () => ({
      state: "idle" as const,
      elapsedSeconds: 0,
      errorKind: null,
      errorReason: null,
      start: vi.fn(),
      cancel: vi.fn(),
      confirm: vi.fn(),
      retry: vi.fn(),
    }),
  };
});

const t0 = "2026-08-01T00:00:00.000Z";

function task(
  overrides: Partial<Extract<IssueDetail, { kind: "task" }>> & { id: string },
): IssueDetail {
  return {
    kind: "task",
    title: "Task",
    partOf: "some-story",
    status: "todo",
    commits: [],
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    needsAttention: false,
    attentionReason: null,
    archived: false,
    description: "Saved description",
    version: "v1",
    ...overrides,
  };
}

function mountDescriptionField(issue: IssueDetail): {
  container: HTMLDivElement;
  root: Root;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<IssueDescriptionField issue={issue} />);
  });
  return { container, root };
}

function displayTrigger(container: ParentNode): HTMLElement {
  const el = container.querySelector("[tabindex='0']");
  expect(el).toBeTruthy();
  return el as HTMLElement;
}

function textarea(container: ParentNode): HTMLTextAreaElement {
  const el = container.querySelector("textarea");
  expect(el).toBeTruthy();
  return el as HTMLTextAreaElement;
}

function enterEdit(container: ParentNode) {
  act(() => {
    displayTrigger(container).click();
  });
}

function setDraft(input: HTMLTextAreaElement, value: string) {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )!.set!;
  act(() => {
    nativeInputValueSetter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("IssueDescriptionField draft persistence", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    container = undefined;
    root = undefined;
    localStorage.clear();
    vi.useRealTimers();
  });

  it("does not leak drafts across issue ids", () => {
    ;({ container, root } = mountDescriptionField(
      task({ id: "task-a", description: "Saved A" }),
    ));

    enterEdit(container!);
    setDraft(textarea(container!), "Draft for A");
    act(() => {
      vi.advanceTimersByTime(300);
    });

    act(() => root!.unmount());
    container!.remove();
    container = undefined;
    root = undefined;

    ;({ container, root } = mountDescriptionField(
      task({ id: "task-b", description: "Saved B" }),
    ));

    enterEdit(container!);
    expect(textarea(container!).value).toBe("Saved B");

    setDraft(textarea(container!), "Draft for B");
    act(() => {
      vi.advanceTimersByTime(300);
    });

    act(() => root!.unmount());
    container!.remove();
    container = undefined;
    root = undefined;

    ;({ container, root } = mountDescriptionField(
      task({ id: "task-a", description: "Saved A" }),
    ));

    enterEdit(container!);
    expect(textarea(container!).value).toBe("Draft for A");
    expect(localStorage.getItem(descriptionDraftStorageKey("task-b"))).toBe(
      "Draft for B",
    );
  });
});
