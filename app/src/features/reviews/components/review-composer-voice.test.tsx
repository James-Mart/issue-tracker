// @vitest-environment happy-dom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VoiceRecordingState } from "@/features/agents/hooks/use-voice-recording";
import {
  release,
  resetVoiceSessionLockForTests,
  reviewVoiceOwner,
  tryAcquire,
} from "@/features/agents/lib/voice-session-lock";
import { ReviewComposer, ReviewDraftProvider } from "./review-composer";

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
let activeRoot: Root | undefined;

vi.mock(
  "@/features/agents/hooks/use-voice-recording",
  async (importOriginal) => {
    const original =
      await importOriginal<
        typeof import("@/features/agents/hooks/use-voice-recording")
      >();
    return {
      ...original,
      useVoiceRecording: (options: {
        onTranscript: (text: string) => void;
      }) => {
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
  },
);

vi.mock("@/features/agents/api/queries", () => ({
  useTranscriptionCapabilityQuery: () => ({
    data: transcriptionCapability,
    isLoading: false,
    isError: transcriptionCapabilityError.value,
  }),
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
  resetVoiceSessionLockForTests();
}

function mount(props: Partial<ComponentProps<typeof ReviewComposer>> = {}): {
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
        <ReviewDraftProvider>
          <ReviewComposer
            draftKey="review:story-1:conversation"
            placeholder="Add a comment"
            submitLabel="Send"
            onSubmit={vi.fn()}
            onCancel={vi.fn()}
            {...props}
          />
        </ReviewDraftProvider>,
      );
    });
  };
  rerender();
  activeRoot = root;
  return { container, root, rerender };
}

function textarea(container: ParentNode): HTMLTextAreaElement {
  const el = container.querySelector("textarea");
  expect(el).toBeTruthy();
  return el as HTMLTextAreaElement;
}

function setDraft(
  input: HTMLTextAreaElement,
  value: string,
  selectionStart = value.length,
  selectionEnd = selectionStart,
) {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )!.set!;
  act(() => {
    nativeInputValueSetter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.setSelectionRange(selectionStart, selectionEnd);
    input.focus();
  });
}

function micButton(container: ParentNode): HTMLButtonElement {
  const el = container.querySelector('[data-testid="voice-mic-button"]');
  expect(el).toBeTruthy();
  return el as HTMLButtonElement;
}

describe("ReviewComposer voice dictation", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;
  let rerender: (() => void) | undefined;

  afterEach(() => {
    if (activeRoot) act(() => activeRoot!.unmount());
    activeRoot = undefined;
    container?.remove();
    container = undefined;
    root = undefined;
    rerender = undefined;
    resetVoiceMocks();
  });

  it("places the mic at the trailing edge of the action row", () => {
    ({ container } = mount());
    const mic = micButton(container!);
    expect(mic.getAttribute("aria-label")).toBe("Dictate comment");
    expect(mic.className).toMatch(/\bml-auto\b/);
    expect(container!.querySelector("textarea")).toBeTruthy();
  });

  it("replaces the field with the recording bar", () => {
    voiceRecording.state = "recording";
    voiceRecording.elapsedSeconds = 12;
    ({ container, root, rerender } = mount());

    expect(container!.querySelector("textarea")).toBeNull();
    expect(
      container!.querySelector('[data-testid="voice-mic-button"]'),
    ).toBeNull();
    expect(
      container!.querySelector('[data-testid="voice-recording-timer"]')
        ?.textContent,
    ).toBe("0:12 / 10:00");

    act(() => {
      (
        container!.querySelector(
          'button[aria-label="Discard recording"]',
        ) as HTMLButtonElement
      ).click();
    });
    expect(voiceRecording.cancel).toHaveBeenCalledTimes(1);

    act(() => {
      (
        container!.querySelector(
          'button[aria-label="Confirm recording"]',
        ) as HTMLButtonElement
      ).click();
    });
    expect(voiceRecording.confirm).toHaveBeenCalledTimes(1);
  });

  it("replaces the field with the transcribing indicator", () => {
    voiceRecording.state = "transcribing";
    ({ container } = mount());
    expect(
      container!.querySelector('[data-testid="voice-transcribing-field"]')
        ?.textContent,
    ).toContain("Transcribing…");
    expect(container!.querySelector("textarea")).toBeNull();
    expect(
      container!.querySelector('[data-testid="voice-mic-button"]'),
    ).toBeNull();
  });

  it("shows the error bar and retries", () => {
    voiceRecording.state = "error";
    voiceRecording.errorReason = "Transcription failed";
    ({ container } = mount());
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

  it("inserts a transcript at the caret and spaces it after typed text", async () => {
    ({ container, root, rerender } = mount());
    const input = textarea(container!);
    setDraft(input, "hello", 5, 5);

    act(() => {
      micButton(container!).click();
    });
    expect(voiceRecording.start).toHaveBeenCalledTimes(1);

    await act(async () => {
      capturedOnTranscript?.("world");
      await Promise.resolve();
    });

    expect(textarea(container!).value).toBe("hello world");
    expect(textarea(container!).selectionStart).toBe(11);
  });

  it("replaces the selected range with the transcript", async () => {
    ({ container } = mount());
    const input = textarea(container!);
    setDraft(input, "hello world", 6, 11);

    act(() => {
      micButton(container!).click();
    });

    await act(async () => {
      capturedOnTranscript?.("there");
    });

    expect(textarea(container!).value).toBe("hello there");
    expect(textarea(container!).selectionStart).toBe(11);
  });

  it("keeps the draft when Escape cancels a recording", () => {
    ({ container, root, rerender } = mount());
    setDraft(textarea(container!), "keep this draft");
    voiceRecording.state = "recording";
    rerender!();

    const escape = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      container!
        .querySelector('[data-testid="review-composer"]')!
        .dispatchEvent(escape);
    });
    expect(voiceRecording.cancel).toHaveBeenCalledTimes(1);
    expect(
      document.body.querySelector(
        '[data-testid="review-composer-discard-dialog"]',
      ),
    ).toBeNull();

    voiceRecording.state = "idle";
    rerender!();
    expect(textarea(container!).value).toBe("keep this draft");
  });

  it("disables the mic when the speech model is unavailable", () => {
    transcriptionCapability.available = false;
    transcriptionCapability.reason = "Speech model not installed";
    ({ container } = mount());
    const mic = micButton(container!);
    expect(mic.disabled).toBe(true);
    expect(mic.title).toBe("Speech model not installed");
  });

  it("does not start while another surface holds the voice lock", () => {
    tryAcquire("description");
    ({ container, root, rerender } = mount());
    const mic = micButton(container!);
    expect(mic.disabled).toBe(true);
    expect(mic.title).toBe("Dictation in use in another composer");
    expect(mic.getAttribute("aria-label")).toBe(
      "Dictation in use in another composer",
    );
    act(() => {
      mic.click();
    });
    expect(voiceRecording.start).not.toHaveBeenCalled();

    act(() => {
      release("description");
    });
    rerender!();
    act(() => {
      micButton(container!).click();
    });
    expect(voiceRecording.start).toHaveBeenCalledTimes(1);
  });

  it("does not start while another review composer holds the voice lock", () => {
    tryAcquire(reviewVoiceOwner("review:story-1:reply:a"));
    ({ container } = mount());
    const mic = micButton(container!);
    expect(mic.disabled).toBe(true);
    expect(mic.title).toBe("Dictation in use in another composer");
    act(() => {
      mic.click();
    });
    expect(voiceRecording.start).not.toHaveBeenCalled();
  });
});
