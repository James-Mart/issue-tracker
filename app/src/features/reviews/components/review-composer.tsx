import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Mic, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { transcribeAudio } from "@/features/agents/api/client";
import { useTranscriptionCapabilityQuery } from "@/features/agents/api/queries";
import {
  VoiceErrorBar,
  VoiceRecordingBar,
  VoiceTranscribingField,
} from "@/features/agents/components/voice-chrome";
import { useVoiceRecording } from "@/features/agents/hooks/use-voice-recording";
import {
  release,
  reviewVoiceOwner,
  tryAcquire,
  useVoiceSessionActiveOwner,
} from "@/features/agents/lib/voice-session-lock";
import { insertTextAtCaret } from "@/lib/insert-text-at-caret";
import { transcriptTextForCaret } from "@/lib/transcript-text-for-caret";
import { useReviewDraft } from "../lib/review-draft-storage";

export const REVIEW_COMPOSER_MIN_LINES = 3;
export const REVIEW_COMPOSER_MAX_LINES = 12;
/** `leading-5` on the field. Used when computed line-height is `normal`. */
export const REVIEW_COMPOSER_LINE_HEIGHT_PX = 20;
/** `py-2` on Textarea. Used when computed padding is not a length. */
const FIELD_PADDING_PX = 16;
/** Hairline border on both edges. Used when computed border is not a length. */
const FIELD_BORDER_PX = 2;

const COMPOSER_HINT = "Enter to send, Shift+Enter for a newline";

/**
 * Field height for a review composer: at least 3 lines, at most 12, then
 * the field scrolls. `scrollHeight` includes padding and excludes border.
 */
export function reviewComposerFieldHeight(
  scrollHeight: number,
  lineHeight: number,
  padding: number,
  border: number,
): { height: number; scrolls: boolean } {
  const min = lineHeight * REVIEW_COMPOSER_MIN_LINES + padding + border;
  const max = lineHeight * REVIEW_COMPOSER_MAX_LINES + padding + border;
  const needed = Math.max(scrollHeight + border, min);
  return { height: Math.min(needed, max), scrolls: needed > max };
}

function lengthOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function applyReviewComposerHeight(el: HTMLTextAreaElement | null): void {
  if (!el) return;
  const style = getComputedStyle(el);
  const parsedLine = Number.parseFloat(style.lineHeight);
  const lineHeight =
    Number.isFinite(parsedLine) && parsedLine > 0
      ? parsedLine
      : REVIEW_COMPOSER_LINE_HEIGHT_PX;
  const padding = lengthOr(
    Number.parseFloat(style.paddingTop) +
      Number.parseFloat(style.paddingBottom),
    FIELD_PADDING_PX,
  );
  const border = lengthOr(
    Number.parseFloat(style.borderTopWidth) +
      Number.parseFloat(style.borderBottomWidth),
    FIELD_BORDER_PX,
  );
  el.style.height = "0px";
  const { height, scrolls } = reviewComposerFieldHeight(
    el.scrollHeight,
    lineHeight,
    padding,
    border,
  );
  el.style.height = `${height}px`;
  el.style.overflowY = scrolls ? "auto" : "hidden";
}

function postBody(
  send: (body: string) => void | Promise<void>,
  body: string,
  clear: () => void,
): void {
  let result: void | Promise<void>;
  try {
    result = send(body);
  } catch {
    // The post already reported the failure. Keep the draft.
    return;
  }
  void Promise.resolve(result).then(
    () => clear(),
    () => {
      // The post already reported the failure. Keep the draft.
    },
  );
}

type ReviewComposerFields = {
  draftKey: string;
  placeholder: string;
  submitLabel: string;
  onSubmit: (body: string) => void | Promise<void>;
  pending?: boolean;
  /** Story composers post the same draft as a question. */
  onQuestion?: (body: string) => void | Promise<void>;
  /**
   * Saved text this composer opened with. Cancel confirms only when the
   * draft differs from it. New composers omit it and confirm whenever
   * the field holds text.
   */
  baseline?: string;
  autoFocus?: boolean;
  /** Hover hint on the field. Defaults to the send hint. */
  fieldHint?: string;
};

export type ReviewComposerProps = ReviewComposerFields &
  (
    | {
        /** Always-present composer. Cancel shows only while a draft is held. */
        persistent: true;
        onCancel?: () => void;
      }
    | { persistent?: false; onCancel: () => void }
  );

export function ReviewComposer({
  draftKey,
  placeholder,
  submitLabel,
  onSubmit,
  onCancel,
  persistent = false,
  pending = false,
  onQuestion,
  baseline,
  autoFocus = false,
  fieldHint = COMPOSER_HINT,
}: ReviewComposerProps) {
  const [draft, setDraft] = useReviewDraft(draftKey);
  const [confirming, setConfirming] = useState(false);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const draftRef = useRef(draft);
  const selectionRef = useRef<{ start: number; end: number } | null>(null);
  const pendingCaretRef = useRef<number | null>(null);
  draftRef.current = draft;
  const voiceOwner = reviewVoiceOwner(draftKey);

  const onTranscript = useCallback(
    (text: string) => {
      // Empty transcription leaves the draft alone, including a selected range.
      if (!text) return;
      const current = draftRef.current;
      const saved = selectionRef.current;
      const start = saved?.start;
      const end = saved?.end;
      const collapsed = start == null || end == null || start === end;
      const insert = collapsed
        ? transcriptTextForCaret(current, start ?? current.length, text)
        : text;
      const inserted = insertTextAtCaret(current, insert, start, end);
      selectionRef.current = {
        start: inserted.selectionStart,
        end: inserted.selectionEnd,
      };
      pendingCaretRef.current = inserted.selectionStart;
      setDraft(inserted.value);
    },
    [setDraft],
  );

  const voice = useVoiceRecording({
    transcribe: transcribeAudio,
    onTranscript,
  });

  const {
    data: transcriptionCapability,
    isError: transcriptionCapabilityError,
  } = useTranscriptionCapabilityQuery();

  const remoteVoiceOwner = useVoiceSessionActiveOwner();
  const peerHoldsVoiceSession =
    remoteVoiceOwner !== null && remoteVoiceOwner !== voiceOwner;
  const voiceState = voice.state;
  const showRecordingBar =
    voiceState === "recording" || voiceState === "review";
  const showVoiceError = voiceState === "error";
  const voiceLocked = voiceState === "transcribing";
  const voiceSessionActive = voiceState !== "idle";
  const fieldCovered = showRecordingBar || showVoiceError || voiceLocked;
  const transcriptionUnavailable =
    transcriptionCapability?.available === false ||
    transcriptionCapabilityError;
  const micUnavailableReason = transcriptionCapabilityError
    ? "Speech model unavailable"
    : transcriptionCapability?.reason;
  const micDisabled =
    pending ||
    voiceSessionActive ||
    peerHoldsVoiceSession ||
    transcriptionUnavailable;
  const micLabel = pending
    ? "Sending…"
    : peerHoldsVoiceSession
      ? "Dictation in use in another composer"
      : transcriptionUnavailable && micUnavailableReason
        ? micUnavailableReason
        : "Dictate comment";

  const holdingDraft = draft.trim().length > 0;
  const dirty = baseline === undefined ? holdingDraft : draft !== baseline;
  const canSend = holdingDraft && !pending && !voiceSessionActive;
  const showCancel = !persistent || holdingDraft;

  useLayoutEffect(() => {
    applyReviewComposerHeight(fieldRef.current);
  }, [draft, fieldCovered]);

  useLayoutEffect(() => {
    const caret = pendingCaretRef.current;
    const el = fieldRef.current;
    if (caret === null || !el) return;
    pendingCaretRef.current = null;
    el.focus();
    el.setSelectionRange(caret, caret);
  }, [draft, fieldCovered]);

  useEffect(() => {
    if (voiceState === "idle") return;
    const root = rootRef.current;
    if (!root || root.contains(document.activeElement)) return;
    root.focus();
  }, [voiceState]);

  const prevVoiceStateRef = useRef(voiceState);
  useEffect(() => {
    const prev = prevVoiceStateRef.current;
    prevVoiceStateRef.current = voiceState;
    if (prev !== "idle" && voiceState === "idle") {
      release(voiceOwner);
    }
  }, [voiceOwner, voiceState]);

  useEffect(() => {
    return () => {
      release(voiceOwner);
    };
  }, [voiceOwner]);

  const handleVoiceStart = () => {
    if (micDisabled) return;
    if (!tryAcquire(voiceOwner)) return;
    const el = fieldRef.current;
    const start =
      el && typeof el.selectionStart === "number"
        ? el.selectionStart
        : draftRef.current.length;
    const end =
      el && typeof el.selectionEnd === "number" ? el.selectionEnd : start;
    selectionRef.current = { start, end };
    voice.start();
  };

  const requestClose = () => {
    if (dirty) {
      setConfirming(true);
      return;
    }
    if (persistent) return;
    onCancel?.();
  };

  const discard = () => {
    setDraft("");
    setConfirming(false);
    onCancel?.();
  };

  const submit = (send: (body: string) => void | Promise<void>) => {
    const body = draft.trim();
    if (!body || pending || voiceSessionActive) return;
    postBody(send, body, () => setDraft(""));
  };

  const onTextareaKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      requestClose();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit(onSubmit);
    }
  };

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      data-testid="review-composer"
      data-draft-key={draftKey}
      data-persistent={persistent ? "" : undefined}
      className="flex min-w-0 flex-col gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || confirming) return;
        event.preventDefault();
        if (voiceState !== "idle") {
          event.stopPropagation();
          voice.cancel();
          return;
        }
        requestClose();
      }}
    >
      {showRecordingBar ? (
        <VoiceRecordingBar
          elapsedSeconds={voice.elapsedSeconds}
          live={voiceState === "recording"}
          onDiscard={voice.cancel}
          onConfirm={voice.confirm}
        />
      ) : showVoiceError ? (
        <VoiceErrorBar
          reason={voice.errorReason ?? "Something went wrong"}
          onRetry={voice.retry}
        />
      ) : voiceLocked ? (
        <VoiceTranscribingField />
      ) : (
        <>
          <Textarea
            ref={fieldRef}
            value={draft}
            rows={REVIEW_COMPOSER_MIN_LINES}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onTextareaKeyDown}
            placeholder={placeholder}
            title={fieldHint}
            aria-label={placeholder}
            autoFocus={autoFocus}
            className="max-h-[16.125rem] min-h-[4.875rem] w-full resize-none leading-5"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="primary"
              onClick={() => submit(onSubmit)}
              disabled={!canSend}
              aria-label={submitLabel}
            >
              {submitLabel}
            </Button>
            {onQuestion ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => submit(onQuestion)}
                disabled={!canSend}
                aria-label="Ask a question"
              >
                Ask a question
              </Button>
            ) : null}
            {showCancel ? (
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                onClick={requestClose}
                title="Cancel"
                aria-label="Cancel"
              >
                <X />
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="ml-auto shrink-0 bg-[hsl(var(--panel))]"
              title={micLabel}
              aria-label={micLabel}
              disabled={micDisabled}
              data-testid="voice-mic-button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={handleVoiceStart}
            >
              <Mic />
            </Button>
          </div>
        </>
      )}
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent
          data-testid="review-composer-discard-dialog"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            keepRef.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>Discard this draft?</DialogTitle>
            <DialogDescription>
              Your text will be lost. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              ref={keepRef}
              type="button"
              variant="ghost"
              onClick={() => setConfirming(false)}
            >
              Keep editing
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={discard}
              data-testid="review-composer-discard"
            >
              Discard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
