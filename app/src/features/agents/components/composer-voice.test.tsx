// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Composer } from "./composer";
import { resetVoiceSessionLockForTests } from "../lib/voice-session-lock";

const startRecording = vi.hoisted(() => vi.fn());

let capturedOnTranscript: ((text: string) => void) | undefined;

vi.mock("../hooks/use-voice-recording", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../hooks/use-voice-recording")>();
  return {
    ...original,
    useVoiceRecording: (options: { onTranscript: (text: string) => void }) => {
      capturedOnTranscript = options.onTranscript;
      return {
        state: "idle",
        elapsedSeconds: 0,
        errorKind: null,
        errorReason: null,
        start: startRecording,
        cancel: vi.fn(),
        confirm: vi.fn(),
        retry: vi.fn(),
      };
    },
  };
});

vi.mock("../api/mutations", () => ({
  useSendConversationMessage: () => ({
    mutate: vi.fn(),
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
    data: { available: true },
    isLoading: false,
    isError: false,
  }),
}));

vi.mock("@/hooks/use-coarse-pointer", () => ({
  useIsCoarsePointer: () => false,
}));

function mountComposer(): { container: HTMLDivElement; root: Root } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <Composer
        conversationId="conv-1"
        model="composer-2.5-fast"
        runActive={false}
      />,
    );
  });
  return { container, root };
}

function textarea(container: ParentNode): HTMLTextAreaElement {
  const el = container.querySelector("textarea");
  expect(el).toBeTruthy();
  return el as HTMLTextAreaElement;
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

describe("Composer voice dictation", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    container = undefined;
    root = undefined;
    startRecording.mockClear();
    capturedOnTranscript = undefined;
    resetVoiceSessionLockForTests();
  });

  it("inserts a transcript at the position recorded when recording started", async () => {
    ({ container, root } = mountComposer());

    const input = textarea(container!);
    setTextareaSelection(input, "hello world", 5);

    act(() => {
      micButton(container!).click();
    });

    expect(startRecording).toHaveBeenCalledTimes(1);

    await act(async () => {
      capturedOnTranscript?.(" there");
      await Promise.resolve();
    });

    expect(textarea(container!).value).toBe("hello there world");
    expect(textarea(container!).selectionStart).toBe(11);
  });
});
