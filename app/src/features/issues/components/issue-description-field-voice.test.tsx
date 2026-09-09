// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IssueDetail } from "@server/schemas";
import type { VoiceRecordingState } from "@/features/agents/hooks/use-voice-recording";
import {
  release,
  resetVoiceSessionLockForTests,
  tryAcquire,
} from "@/features/agents/lib/voice-session-lock";
import { IssueDescriptionField } from "./issue-description-field";

const mutateAsync = vi.fn();
const transcribeAudio = vi.fn<(samples: Float32Array) => Promise<string>>();

const voiceRecording = vi.hoisted(() => ({
  state: "idle" as VoiceRecordingState,
  elapsedSeconds: 0,
  errorKind: null as "permission" | "transcription" | null,
  errorReason: null as string | null,
  start: vi.fn(),
  cancel: vi.fn(),
  confirm: vi.fn(),
  retry: vi.fn(),
}));

const transcriptionCapability = vi.hoisted(() => ({
  available: true,
  reason: undefined as string | undefined,
}));
const transcriptionCapabilityError = vi.hoisted(() => ({ value: false }));

let capturedOnTranscript: ((text: string) => void) | undefined;
let capturedTranscribe:
  | ((samples: Float32Array) => Promise<string>)
  | undefined;

vi.mock("../api/mutations", () => ({
  useUpdateIssue: () => ({
    mutateAsync,
  }),
}));

vi.mock("@/features/agents/api/client", () => ({
  transcribeAudio: (samples: Float32Array) => transcribeAudio(samples),
}));

vi.mock("@/features/agents/api/queries", () => ({
  useTranscriptionCapabilityQuery: () => ({
    data: transcriptionCapability,
    isLoading: false,
    isError: transcriptionCapabilityError.value,
  }),
}));

vi.mock("@/features/agents/hooks/use-voice-recording", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("@/features/agents/hooks/use-voice-recording")
    >();
  return {
    ...original,
    useVoiceRecording: (options: {
      transcribe: (samples: Float32Array) => Promise<string>;
      onTranscript: (text: string) => void;
    }) => {
      capturedOnTranscript = options.onTranscript;
      capturedTranscribe = options.transcribe;
      return {
        state: voiceRecording.state,
        elapsedSeconds: voiceRecording.elapsedSeconds,
        errorKind: voiceRecording.errorKind,
        errorReason: voiceRecording.errorReason,
        start: voiceRecording.start,
        cancel: voiceRecording.cancel,
        confirm: voiceRecording.confirm,
        retry: voiceRecording.retry,
      };
    },
  };
});

const t0 = "2026-08-01T00:00:00.000Z";

function task(
  overrides: Partial<IssueDetail> & { id: string; description?: string },
): IssueDetail {
  return {
    id: overrides.id,
    kind: "task",
    title: "Task",
    partOf: "some-story",
    order: 0,
    createdAt: t0,
    updatedAt: t0,
    archived: false,
    description: overrides.description ?? "Saved description",
    labels: [],
    version: overrides.version ?? "v1",
    ...overrides,
  };
}

function resetVoiceMocks() {
  voiceRecording.state = "idle";
  voiceRecording.elapsedSeconds = 0;
  voiceRecording.errorKind = null;
  voiceRecording.errorReason = null;
  voiceRecording.start.mockClear();
  voiceRecording.cancel.mockClear();
  voiceRecording.confirm.mockClear();
  voiceRecording.retry.mockClear();
  transcriptionCapability.available = true;
  transcriptionCapability.reason = undefined;
  transcriptionCapabilityError.value = false;
  capturedOnTranscript = undefined;
  capturedTranscribe = undefined;
  transcribeAudio.mockReset();
  resetVoiceSessionLockForTests();
}

function mountDescriptionField(issue: IssueDetail): {
  container: HTMLDivElement;
  root: Root;
  rerender: () => void;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const rerender = () => {
    act(() => {
      root.render(<IssueDescriptionField issue={issue} />);
    });
  };
  rerender();
  return { container, root, rerender };
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

function micButton(container: ParentNode): HTMLButtonElement {
  const el = container.querySelector('[data-testid="voice-mic-button"]');
  expect(el).toBeTruthy();
  return el as HTMLButtonElement;
}

function setTextareaSelection(
  input: HTMLTextAreaElement,
  value: string,
  selectionStart: number,
) {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )!.set!;
  act(() => {
    nativeInputValueSetter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.setSelectionRange(selectionStart, selectionStart);
    input.focus();
  });
}

function pressEscape(input: HTMLTextAreaElement) {
  act(() => {
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

function blurTextarea(input: HTMLTextAreaElement) {
  act(() => {
    input.blur();
  });
}

describe("IssueDescriptionField voice dictation", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;
  let rerender: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    mutateAsync.mockReset();
    resetVoiceMocks();
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    container = undefined;
    root = undefined;
    rerender = undefined;
    localStorage.clear();
    vi.useRealTimers();
  });

  it("inserts a leading space when the caret follows non-whitespace", async () => {
    ({ container, root, rerender } = mountDescriptionField(
      task({ id: "task-a", description: "hello world" }),
    ));

    act(() => {
      displayTrigger(container!).click();
    });
    setTextareaSelection(textarea(container!), "hello world", 5);

    act(() => {
      micButton(container!).click();
    });
    expect(voiceRecording.start).toHaveBeenCalledTimes(1);

    await act(async () => {
      capturedOnTranscript?.("there");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(textarea(container!).value).toBe("hello there world");
    expect(textarea(container!).selectionStart).toBe(11);
  });

  it("does not prepend a space at the start or after whitespace", async () => {
    ({ container, root, rerender } = mountDescriptionField(
      task({ id: "task-a", description: "" }),
    ));

    act(() => {
      displayTrigger(container!).click();
    });
    setTextareaSelection(textarea(container!), "", 0);
    act(() => {
      micButton(container!).click();
    });

    await act(async () => {
      capturedOnTranscript?.("Hello");
      await Promise.resolve();
    });

    expect(textarea(container!).value).toBe("Hello");

    setTextareaSelection(textarea(container!), "Hello ", 6);
    act(() => {
      micButton(container!).click();
    });
    await act(async () => {
      capturedOnTranscript?.("world");
      await Promise.resolve();
    });

    expect(textarea(container!).value).toBe("Hello world");
  });

  it("starts from view by entering edit and recording at the end", async () => {
    ({ container, root, rerender } = mountDescriptionField(
      task({ id: "task-a", description: "Saved description" }),
    ));

    expect(container!.querySelector("textarea")).toBeNull();

    act(() => {
      micButton(container!).click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container!.querySelector("textarea")).toBeTruthy();
    expect(voiceRecording.start).toHaveBeenCalledTimes(1);

    await act(async () => {
      capturedOnTranscript?.("appended");
      await Promise.resolve();
    });

    expect(textarea(container!).value).toBe("Saved description appended");
    expect(textarea(container!).selectionStart).toBe(
      "Saved description appended".length,
    );
  });

  it("calls cancel on Escape during recording and keeps edit mode open", () => {
    voiceRecording.state = "recording";
    ({ container, root, rerender } = mountDescriptionField(
      task({ id: "task-a", description: "Saved description" }),
    ));

    act(() => {
      displayTrigger(container!).click();
    });

    pressEscape(textarea(container!));

    expect(voiceRecording.cancel).toHaveBeenCalledTimes(1);
    expect(container!.querySelector("textarea")).toBeTruthy();
  });

  it("defers blur-commit while voice state is not idle", async () => {
    mutateAsync.mockResolvedValue(undefined);
    voiceRecording.state = "recording";
    ({ container, root, rerender } = mountDescriptionField(
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

  it("wires confirm through transcribeAudio and onTranscript", async () => {
    transcribeAudio.mockResolvedValue("spoken text");
    ({ container, root, rerender } = mountDescriptionField(
      task({ id: "task-a", description: "Saved" }),
    ));

    act(() => {
      displayTrigger(container!).click();
    });
    setTextareaSelection(textarea(container!), "Saved", 5);

    expect(capturedTranscribe).toBeDefined();

    await act(async () => {
      const text = await capturedTranscribe!(new Float32Array([0.1, 0.2]));
      capturedOnTranscript?.(text);
      await Promise.resolve();
    });

    expect(transcribeAudio).toHaveBeenCalled();
    expect(textarea(container!).value).toBe("Saved spoken text");
  });

  it("disables the microphone when capability is unavailable", () => {
    transcriptionCapability.available = false;
    transcriptionCapability.reason = "Speech model not installed";
    ({ container, root, rerender } = mountDescriptionField(
      task({ id: "task-a" }),
    ));

    const mic = micButton(container!);
    expect(mic.disabled).toBe(true);
    expect(mic.title).toBe("Speech model not installed");

    act(() => {
      mic.click();
    });
    expect(voiceRecording.start).not.toHaveBeenCalled();
  });

  it("shows the recording bar in label chrome while recording", () => {
    voiceRecording.state = "recording";
    voiceRecording.elapsedSeconds = 42;
    ({ container, root, rerender } = mountDescriptionField(
      task({ id: "task-a" }),
    ));

    expect(
      container!.querySelector('[data-testid="voice-recording-bar"]'),
    ).toBeTruthy();
    expect(
      container!.querySelector('[data-testid="voice-mic-button"]'),
    ).toBeNull();
    expect(container!.querySelector("textarea")).toBeNull();
  });

  it.each([
    "recording",
    "review",
    "transcribing",
    "error",
  ] as const)(
    "disables the microphone while the composer holds the voice lock (%s)",
    () => {
      tryAcquire("composer");
      ({ container, root, rerender } = mountDescriptionField(
        task({ id: "task-a" }),
      ));

      const mic = micButton(container!);
      expect(mic.disabled).toBe(true);

      act(() => {
        mic.click();
      });
      expect(voiceRecording.start).not.toHaveBeenCalled();
    },
  );

  it("does not start when the composer holds the voice lock", () => {
    tryAcquire("composer");
    ({ container, root, rerender } = mountDescriptionField(
      task({ id: "task-a" }),
    ));

    act(() => {
      micButton(container!).click();
    });
    expect(voiceRecording.start).not.toHaveBeenCalled();
  });

  it("allows recording after the composer releases the voice lock", async () => {
    tryAcquire("composer");
    ({ container, root, rerender } = mountDescriptionField(
      task({ id: "task-a" }),
    ));

    release("composer");
    rerender!();

    act(() => {
      micButton(container!).click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(voiceRecording.start).toHaveBeenCalledTimes(1);
  });
});
