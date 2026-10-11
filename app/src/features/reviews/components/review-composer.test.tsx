// @vitest-environment happy-dom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VoiceRecordingState } from "@/features/agents/hooks/use-voice-recording";
import { resetVoiceSessionLockForTests } from "@/features/agents/lib/voice-session-lock";
import { ReviewComposer } from "./review-composer";

const voiceRecording = vi.hoisted(() => ({
  state: "idle" as VoiceRecordingState,
  elapsedSeconds: 0,
  errorKind: null,
  errorReason: null,
  start: vi.fn(),
  cancel: vi.fn(),
  confirm: vi.fn(),
  retry: vi.fn(),
}));

vi.mock("@/features/agents/hooks/use-voice-recording", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/agents/hooks/use-voice-recording")>()),
  useVoiceRecording: () => ({ ...voiceRecording }),
}));

vi.mock("@/features/agents/api/queries", () => ({
  useTranscriptionCapabilityQuery: () => ({
    data: { available: true },
    isLoading: false,
    isError: false,
  }),
}));

function mount(
  props: Partial<ComponentProps<typeof ReviewComposer>> = {},
): { container: HTMLDivElement; root: Root; rerender: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const rerender = () => {
    act(() => {
      root.render(
        <ReviewComposer
          draftKey="review:story-1:conversation"
          placeholder="Add a comment"
          submitLabel="Send"
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          {...props}
        />,
      );
    });
  };
  rerender();
  return { container, root, rerender };
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

afterEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  voiceRecording.state = "idle";
  voiceRecording.cancel.mockClear();
  resetVoiceSessionLockForTests();
});

describe("ReviewComposer", () => {
  it("closes an empty composer immediately and confirms before discarding text", () => {
    const onCancel = vi.fn();
    const { container } = mount({ onCancel });
    act(() => {
      container
        .querySelector('[aria-label="Cancel"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onCancel).toHaveBeenCalledOnce();
    expect(document.body.querySelector('[data-testid="review-composer-discard-dialog"]')).toBeNull();

    onCancel.mockClear();
    setDraft(container.querySelector("textarea")!, "Keep me");
    const escape = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      container.querySelector("textarea")!.dispatchEvent(escape);
    });
    expect(onCancel).not.toHaveBeenCalled();
    const dialog = document.body.querySelector(
      '[data-testid="review-composer-discard-dialog"]',
    );
    expect(dialog?.textContent).toContain("Discard this draft?");
    expect(dialog?.textContent).toContain("Your text will be lost. This cannot be undone.");
    act(() => {
      dialog
        ?.querySelector('[data-testid="review-composer-discard"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onCancel).toHaveBeenCalledOnce();
    expect(container.querySelector("textarea")?.value).toBe("");
  });

  it("stores the draft in this browser under its key and restores it after a reload", () => {
    const { container, root } = mount();
    setDraft(container.querySelector("textarea")!, "Survives reload");
    expect(localStorage.getItem("review:story-1:conversation")).toBe("Survives reload");

    act(() => root.unmount());
    document.body.innerHTML = "";
    const reloaded = mount();
    expect(reloaded.container.querySelector("textarea")?.value).toBe("Survives reload");
  });

  it("clears the stored draft once the send lands and keeps it when the send fails", async () => {
    let settle: { resolve: () => void; reject: () => void } | undefined;
    const onSubmit = vi.fn(
      () =>
        new Promise<void>((resolve, reject) => {
          settle = { resolve, reject: () => reject(new Error("not posted")) };
        }),
    );
    const { container } = mount({ onSubmit });
    setDraft(container.querySelector("textarea")!, "Try once");
    act(() => {
      container
        .querySelector('button[aria-label="Send"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => settle!.reject());
    expect(localStorage.getItem("review:story-1:conversation")).toBe("Try once");

    act(() => {
      container
        .querySelector('button[aria-label="Send"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => settle!.resolve());
    expect(localStorage.getItem("review:story-1:conversation")).toBeNull();
    expect(container.querySelector("textarea")?.value).toBe("");
  });

  it("keeps the draft when Escape cancels a recording", () => {
    const { container, rerender } = mount();
    setDraft(container.querySelector("textarea")!, "keep this draft");
    voiceRecording.state = "recording";
    rerender();

    act(() => {
      container
        .querySelector('[data-testid="review-composer"]')!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
        );
    });
    expect(voiceRecording.cancel).toHaveBeenCalledTimes(1);
    expect(
      document.body.querySelector('[data-testid="review-composer-discard-dialog"]'),
    ).toBeNull();

    voiceRecording.state = "idle";
    rerender();
    expect(container.querySelector("textarea")?.value).toBe("keep this draft");
  });
});
