import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { X } from "lucide-react";
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

export const REVIEW_COMPOSER_MIN_LINES = 3;
export const REVIEW_COMPOSER_MAX_LINES = 12;
/** `leading-5` on the field. Used when computed line-height is `normal`. */
export const REVIEW_COMPOSER_LINE_HEIGHT_PX = 20;
/** `py-2` on Textarea. Used when computed padding is not a length. */
const FIELD_PADDING_PX = 16;
/** Hairline border on both edges. Used when computed border is not a length. */
const FIELD_BORDER_PX = 2;

const COMPOSER_HINT = "Enter to send, Shift+Enter for a newline";

type ReviewDraftContextValue = {
  drafts: Record<string, string>;
  setDraft: (key: string, value: string) => void;
};

const ReviewDraftContext = createContext<ReviewDraftContextValue | null>(null);

/** Keeps review drafts while a composer unmounts and the same spot reopens. */
export function ReviewDraftProvider({ children }: { children: ReactNode }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const setDraft = useCallback((key: string, value: string) => {
    setDrafts((prev) => {
      if (value) {
        if (prev[key] === value) return prev;
        return { ...prev, [key]: value };
      }
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);
  const value = useMemo(() => ({ drafts, setDraft }), [drafts, setDraft]);
  return (
    <ReviewDraftContext.Provider value={value}>
      {children}
    </ReviewDraftContext.Provider>
  );
}

/** Uses the surrounding draft store, or starts one when this subtree is the root. */
export function ReviewDraftScope({ children }: { children: ReactNode }) {
  const parent = useContext(ReviewDraftContext);
  if (parent) return children;
  return <ReviewDraftProvider>{children}</ReviewDraftProvider>;
}

function useReviewDraft(draftKey: string): [string, (value: string) => void] {
  const store = useContext(ReviewDraftContext);
  if (!store) {
    throw new Error("ReviewComposer must be used under ReviewDraftProvider");
  }
  const draft = store.drafts[draftKey] ?? "";
  const setDraft = (value: string) => store.setDraft(draftKey, value);
  return [draft, setDraft];
}

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
    Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom),
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
}: ReviewComposerProps) {
  const [draft, setDraft] = useReviewDraft(draftKey);
  const [confirming, setConfirming] = useState(false);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const holdingDraft = draft.trim().length > 0;
  const canSend = holdingDraft && !pending;
  const showCancel = !persistent || holdingDraft;

  useLayoutEffect(() => {
    applyReviewComposerHeight(fieldRef.current);
  }, [draft]);

  const requestClose = () => {
    if (holdingDraft) {
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
    if (!body || pending) return;
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
      data-testid="review-composer"
      data-draft-key={draftKey}
      data-persistent={persistent ? "" : undefined}
      className="flex min-w-0 flex-col gap-2"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || confirming) return;
        event.preventDefault();
        requestClose();
      }}
    >
      <Textarea
        ref={fieldRef}
        value={draft}
        rows={REVIEW_COMPOSER_MIN_LINES}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onTextareaKeyDown}
        placeholder={placeholder}
        title={COMPOSER_HINT}
        aria-label={placeholder}
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
      </div>
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
