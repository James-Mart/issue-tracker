// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Composer } from "./composer";
import type { VoiceRecordingState } from "../hooks/use-voice-recording";
import { VOICE_RECORDING_CAP_SECONDS } from "../hooks/use-voice-recording";

const sendMutate = vi.fn();

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

vi.mock("../hooks/use-voice-recording", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../hooks/use-voice-recording")>();
  return {
    ...original,
    useVoiceRecording: (options: { onTranscript: (text: string) => void }) => {
      capturedOnTranscript = options.onTranscript;
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

vi.mock("../api/mutations", () => ({
  useSendConversationMessage: () => ({
    mutate: sendMutate,
    isPending: false,
  }),
  useInterruptConversationRun: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useCancelConversationRun: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useUpdateConversation: () => ({
    mutate: vi.fn(),
  }),
  useUploadConversationAttachment: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useDeleteConversationAttachment: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock("../api/queries", () => ({
  useAgentModelsQuery: () => ({
    data: {
      models: [{ id: "composer-2.5-fast", displayName: "Composer" }],
    },
    isLoading: false,
  }),
  useTranscriptionCapabilityQuery: () => ({
    data: transcriptionCapability,
    isLoading: false,
    isError: transcriptionCapabilityError.value,
  }),
}));

vi.mock("@/hooks/use-coarse-pointer", () => ({
  useIsCoarsePointer: () => false,
}));

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
}

function mountComposer(): {
  container: HTMLDivElement;
  root: Root;
  rerender: () => void;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const rerender = () => {
    act(() => {
      root.render(
        <Composer
          conversationId="conv-1"
          model="composer-2.5-fast"
          runActive={false}
        />,
      );
    });
  };
  rerender();
  return { container, root, rerender };
}

function textarea(container: ParentNode): HTMLTextAreaElement {
  const el = container.querySelector("textarea");
  expect(el).toBeTruthy();
  return el as HTMLTextAreaElement;
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

function micButton(container: ParentNode): HTMLButtonElement {
  const el = container.querySelector('[data-testid="voice-mic-button"]');
  expect(el).toBeTruthy();
  return el as HTMLButtonElement;
}

function sendButton(container: ParentNode): HTMLButtonElement {
  const el = container.querySelector('button[aria-label="Send"]');
  expect(el).toBeTruthy();
  return el as HTMLButtonElement;
}

describe("Composer voice dictation", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;
  let rerender: (() => void) | undefined;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    container = undefined;
    root = undefined;
    rerender = undefined;
    sendMutate.mockClear();
    resetVoiceMocks();
  });

  it("shows the recording bar with a running timer over the action row", () => {
    voiceRecording.state = "recording";
    voiceRecording.elapsedSeconds = 84;
    ({ container, root, rerender } = mountComposer());

    expect(
      container!.querySelector('[data-testid="voice-recording-bar"]'),
    ).toBeTruthy();
    expect(
      container!.querySelector('[data-testid="voice-mic-button"]'),
    ).toBeNull();
    expect(
      container!.querySelector('[data-testid="voice-recording-timer"]')
        ?.textContent,
    ).toBe("1:24 / 10:00");
  });

  it("shows the review bar with the timer stilled at the cap and confirm active", () => {
    voiceRecording.state = "review";
    voiceRecording.elapsedSeconds = VOICE_RECORDING_CAP_SECONDS;
    ({ container, root, rerender } = mountComposer());

    expect(
      container!.querySelector('[data-testid="voice-recording-bar"]'),
    ).toBeTruthy();
    expect(
      container!.querySelector('[data-testid="voice-recording-timer"]')
        ?.textContent,
    ).toBe("10:00 / 10:00");
    expect(
      container!.querySelector('button[aria-label="Confirm recording"]'),
    ).toBeTruthy();
  });

  it("shows the locked row while transcribing", () => {
    voiceRecording.state = "transcribing";
    ({ container, root, rerender } = mountComposer());

    expect(
      container!.querySelector('[data-testid="voice-transcribing-field"]'),
    ).toBeTruthy();
    expect(micButton(container!).disabled).toBe(true);
    expect(
      container!.querySelector('button[aria-label="Attach files"]')!.className,
    ).toMatch(/opacity-50/);
    expect(sendButton(container!).disabled).toBe(true);
  });

  it("inserts a transcript at the position recorded when recording started", async () => {
    ({ container, root, rerender } = mountComposer());

    const input = textarea(container!);
    setTextareaSelection(input, "hello world", 5);

    act(() => {
      micButton(container!).click();
    });

    expect(voiceRecording.start).toHaveBeenCalledTimes(1);

    await act(async () => {
      capturedOnTranscript?.(" there");
      await Promise.resolve();
    });

    expect(textarea(container!).value).toBe("hello there world");
    expect(textarea(container!).selectionStart).toBe(11);
  });

  it("leaves the draft untouched when cancel is invoked from the recording bar", () => {
    ({ container, root, rerender } = mountComposer());

    setDraft(textarea(container!), "keep this draft");

    voiceRecording.state = "recording";
    rerender!();

    act(() => {
      (
        container!.querySelector(
          'button[aria-label="Discard recording"]',
        ) as HTMLButtonElement
      ).click();
    });

    expect(voiceRecording.cancel).toHaveBeenCalledTimes(1);

    voiceRecording.state = "idle";
    rerender!();

    expect(textarea(container!).value).toBe("keep this draft");
  });

  it("renders permission errors with retry wired to retry()", () => {
    voiceRecording.state = "error";
    voiceRecording.errorKind = "permission";
    voiceRecording.errorReason = "Microphone permission denied";
    ({ container, root, rerender } = mountComposer());

    expect(
      container!.querySelector('[data-testid="voice-error-bar"]')?.textContent,
    ).toContain("Microphone permission denied");

    act(() => {
      (
        container!.querySelector(
          '[data-testid="voice-error-retry"]',
        ) as HTMLButtonElement
      ).click();
    });

    expect(voiceRecording.retry).toHaveBeenCalledTimes(1);
  });

  it("renders transcription errors with retry wired to retry()", () => {
    voiceRecording.state = "error";
    voiceRecording.errorKind = "transcription";
    voiceRecording.errorReason = "Transcription failed";
    ({ container, root, rerender } = mountComposer());

    expect(
      container!.querySelector('[data-testid="voice-error-bar"]')?.textContent,
    ).toContain("Transcription failed");

    act(() => {
      (
        container!.querySelector(
          '[data-testid="voice-error-retry"]',
        ) as HTMLButtonElement
      ).click();
    });

    expect(voiceRecording.retry).toHaveBeenCalledTimes(1);
  });

  it("renders the mic disabled with a reason when capability is unavailable", () => {
    transcriptionCapability.available = false;
    transcriptionCapability.reason = "Speech model not installed";
    ({ container, root, rerender } = mountComposer());

    const mic = micButton(container!);
    expect(mic.disabled).toBe(true);
    expect(mic.title).toBe("Speech model not installed");
  });

  it("renders the mic disabled when the capability query fails", () => {
    transcriptionCapabilityError.value = true;
    ({ container, root, rerender } = mountComposer());

    const mic = micButton(container!);
    expect(mic.disabled).toBe(true);
    expect(mic.title).toBe("Speech model unavailable");
  });
});
