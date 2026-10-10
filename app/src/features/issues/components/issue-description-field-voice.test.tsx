// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IssueDetail } from "@server/schemas";
import { resetVoiceSessionLockForTests } from "@/features/agents/lib/voice-session-lock";
import { IssueDescriptionField } from "./issue-description-field";

const mutateAsync = vi.fn();

vi.mock("../api/mutations", () => ({
  useUpdateIssue: () => ({
    mutateAsync,
  }),
}));

vi.mock("@/features/agents/api/client", () => ({
  transcribeAudio: vi.fn(),
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
      state: "recording",
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
    archived: false,
    needsAttention: false,
    attentionReason: null,
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

function blurTextarea(input: HTMLTextAreaElement) {
  act(() => {
    input.blur();
  });
}

describe("IssueDescriptionField voice dictation", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    mutateAsync.mockReset();
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    container = undefined;
    root = undefined;
    localStorage.clear();
    resetVoiceSessionLockForTests();
    vi.useRealTimers();
  });

  it("defers blur-commit while voice state is not idle", async () => {
    mutateAsync.mockResolvedValue(undefined);
    ({ container, root } = mountDescriptionField(
      task({ id: "task-a", description: "Saved description" }),
    ));

    act(() => {
      displayTrigger(container!).click();
    });

    blurTextarea(textarea(container!));
    await act(async () => {
      vi.advanceTimersByTime(0);
      await Promise.resolve();
    });

    expect(mutateAsync).not.toHaveBeenCalled();
    expect(container!.querySelector("textarea")).toBeTruthy();
  });
});
