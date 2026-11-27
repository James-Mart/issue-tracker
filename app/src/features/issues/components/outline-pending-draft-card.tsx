import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { IssueDetail } from "@server/schemas";
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
import { reviewIssuePath } from "@/features/reviews/lib/links";
import {
  useApproveOutlineDraft,
  useDiscardOutlineDraft,
  useSetOutlineDraft,
} from "../api/mutations";
import { DetailEyebrow } from "./detail-section";

const DRAFT_PERSIST_DEBOUNCE_MS = 300;

export type OutlineWithDraft = Extract<IssueDetail, { kind: "outline" }> & {
  pendingDraft: NonNullable<IssueDetail["pendingDraft"]>;
};

/** Toast already reports a failed save; this only avoids an unhandled rejection. */
function forgetDraftSave(save: Promise<unknown>): void {
  void save.catch(() => undefined);
}

/**
 * The outline's one pending draft, owned by a review's outline check.
 * Typing rewrites that draft. Approve and Discard settle the gate.
 */
export function OutlinePendingDraftCard({
  issue,
}: {
  issue: OutlineWithDraft;
}) {
  const { mutateAsync, isPending: saving } = useSetOutlineDraft(issue.id);
  const approve = useApproveOutlineDraft(issue.id);
  const discard = useDiscardOutlineDraft(issue.id);
  const saved = issue.pendingDraft.body;
  const [text, setText] = useState(saved);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const textRef = useRef(text);
  const savedRef = useRef(saved);
  const focusedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  textRef.current = text;
  savedRef.current = saved;

  const persist = useCallback(
    (body: string) => mutateAsync(body),
    [mutateAsync],
  );

  const clearSaveTimer = () => {
    if (saveTimerRef.current === null) return;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
  };

  useEffect(() => {
    if (focusedRef.current) return;
    setText(saved);
  }, [saved]);

  useEffect(() => {
    if (text === saved) return;
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      forgetDraftSave(persist(text));
    }, DRAFT_PERSIST_DEBOUNCE_MS);
    return () => {
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [text, saved, persist]);

  const flush = useCallback(async () => {
    clearSaveTimer();
    if (textRef.current === savedRef.current) return;
    await persist(textRef.current);
  }, [persist]);

  const busy = approve.isPending || discard.isPending;
  const approveDraft = () => {
    forgetDraftSave(
      flush().then(() => {
        approve.mutate();
      }),
    );
  };

  return (
    <section
      className="rounded-lg border border-[hsl(var(--current)/0.4)] bg-card p-5"
      data-testid="outline-pending-draft"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <DetailEyebrow>Pending draft</DetailEyebrow>
          <Link
            to={reviewIssuePath(issue.partOf, issue.pendingDraft.review)}
            className="text-sm text-primary hover:underline"
            data-testid="outline-draft-from-review"
          >
            from review
          </Link>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="outline-draft-discard"
            disabled={busy}
            onClick={() => setConfirmDiscard(true)}
          >
            Discard
          </Button>
          <Button
            type="button"
            variant="current"
            size="sm"
            data-testid="outline-draft-approve"
            disabled={busy || saving}
            onClick={approveDraft}
          >
            Approve
          </Button>
        </div>
      </div>
      <Textarea
        value={text}
        aria-label="Pending draft"
        data-testid="outline-draft-body"
        spellCheck={false}
        disabled={busy}
        className="min-h-[10rem] font-mono text-sm"
        onFocus={() => {
          focusedRef.current = true;
        }}
        onBlur={() => {
          focusedRef.current = false;
          forgetDraftSave(flush());
        }}
        onChange={(event) => setText(event.target.value)}
      />
      <Dialog
        open={confirmDiscard}
        onOpenChange={(next) => {
          if (discard.isPending && !next) return;
          setConfirmDiscard(next);
        }}
      >
        <DialogContent data-testid="outline-draft-discard-dialog">
          <DialogHeader>
            <DialogTitle>Discard draft?</DialogTitle>
            <DialogDescription>
              The pending draft is dropped. The linked review records that you are
              not adopting it now. The saved outline stays as it is.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={discard.isPending}
              onClick={() => setConfirmDiscard(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              data-testid="outline-draft-discard-confirm"
              disabled={discard.isPending}
              onClick={() => discard.mutate()}
            >
              Discard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
