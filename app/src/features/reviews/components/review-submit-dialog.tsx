import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { isInclusionThreadEvent, type ReviewSubmitDestination } from "@server/schemas";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { SUPPORTING_DOC_KEY_LABELS } from "@/features/issues/lib/supporting-docs";
import {
  Dialog,
  DialogContent,
  DialogField,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { changedFileRowClass } from "@/features/issues/components/changed-file-row";
import { usePostThreadEvent } from "@/features/issues/api/mutations";
import { ThreadInclusionToggle } from "@/features/issues/components/comments/thread-inclusion-toggle";
import type { CommentThread } from "@/features/issues/lib/comment-threads";
import { cn } from "@/lib/utils/cn";
import {
  NO_THREADS_INCLUDED,
  notIncludedLabel,
  threadsToSubmitLabel,
} from "../lib/review-submission-ui";
import { reviewThreadExcerpt, reviewThreadLocation } from "../lib/review-thread-label";

type InclusionEvents = Pick<
  ReturnType<typeof usePostThreadEvent>,
  "isPending" | "variables" | "mutate"
>;

function DestinationOption({
  value,
  selected,
  onSelect,
  children,
}: {
  value: ReviewSubmitDestination;
  selected: boolean;
  onSelect: (value: ReviewSubmitDestination) => void;
  children: ReactNode;
}) {
  return (
    <label
      data-testid={`submit-destination-${value}`}
      className={cn(
        "flex min-w-0 cursor-pointer items-center gap-2.5",
        changedFileRowClass(selected),
        "px-3 py-2.5 font-sans text-sm font-medium focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
      )}
    >
      <input
        type="radio"
        name="submit-destination"
        value={value}
        checked={selected}
        className="size-4 shrink-0 accent-[hsl(var(--current))] focus-visible:outline-none"
        onChange={() => onSelect(value)}
      />
      <span className="min-w-0 break-words">{children}</span>
    </label>
  );
}

function SubmitDialogThreadRow({
  thread,
  events,
}: {
  thread: CommentThread;
  events: InclusionEvents;
}) {
  const pending =
    events.isPending &&
    events.variables?.threadId === thread.root.id &&
    events.variables.event !== undefined &&
    isInclusionThreadEvent(events.variables.event);
  return (
    <li
      data-thread-id={thread.root.id}
      className="flex min-w-0 items-start gap-2 rounded-md border border-border bg-card px-3 py-2"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="break-all font-mono text-xs tabular-nums text-muted-foreground">
          {reviewThreadLocation(thread.root.anchor)}
        </span>
        <span className="line-clamp-2 text-sm text-foreground">
          {reviewThreadExcerpt(thread.root.body)}
        </span>
      </span>
      <ThreadInclusionToggle
        included={thread.included}
        pending={pending}
        onToggle={() =>
          events.mutate({
            threadId: thread.root.id,
            event: thread.included ? "excluded" : "included",
          })
        }
      />
    </li>
  );
}

function SubmitThreadList({
  threads,
  events,
  testId,
  labelledBy,
}: {
  threads: readonly CommentThread[];
  events: InclusionEvents;
  testId: string;
  labelledBy: string;
}) {
  return (
    <ul
      aria-labelledby={labelledBy}
      data-testid={testId}
      className="m-0 flex list-none flex-col gap-2 p-0"
    >
      {threads.map((thread) => (
        <SubmitDialogThreadRow key={thread.root.id} thread={thread} events={events} />
      ))}
    </ul>
  );
}

function NotIncludedSection({
  threads,
  events,
  forceOpen,
}: {
  threads: readonly CommentThread[];
  events: InclusionEvents;
  /** Nothing is included, so the toggles this section holds stay in view. */
  forceOpen: boolean;
}) {
  const [open, setOpen] = useState(false);
  const expanded = forceOpen || open;
  const panelId = "submit-review-not-included-threads";
  return (
    <details open={expanded} className="group rounded-md border border-border bg-card">
      <summary
        aria-expanded={expanded}
        aria-controls={panelId}
        id="submit-review-not-included"
        data-testid="submit-review-not-included"
        className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 px-3 marker:content-none hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"
        onClick={(event) => {
          event.preventDefault();
          if (!forceOpen) setOpen((current) => !current);
        }}
      >
        <ChevronRight
          aria-hidden
          className="h-3.5 w-3.5 shrink-0 text-muted-foreground motion-safe:transition-transform group-open:rotate-90"
        />
        <span className="text-sm text-foreground">{notIncludedLabel(threads.length)}</span>
      </summary>
      {expanded ? (
        <div id={panelId} className="border-t border-border p-2">
          <SubmitThreadList
            threads={threads}
            events={events}
            testId="submit-review-not-included-threads"
            labelledBy="submit-review-not-included"
          />
        </div>
      ) : null}
    </details>
  );
}

function ThreadsToSubmit({
  included,
  notIncluded,
  reviewId,
}: {
  included: readonly CommentThread[];
  notIncluded: readonly CommentThread[];
  reviewId: string;
}) {
  const events = usePostThreadEvent(reviewId);
  return (
    <div className="flex flex-col gap-2">
      <p id="submit-review-threads-label" className="text-sm font-medium leading-none text-foreground">
        {threadsToSubmitLabel(included.length)}
      </p>
      {included.length === 0 ? (
        <p
          data-testid="submit-review-threads-empty"
          className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground"
        >
          {NO_THREADS_INCLUDED}
        </p>
      ) : (
        <SubmitThreadList
          threads={included}
          events={events}
          testId="submit-review-threads"
          labelledBy="submit-review-threads-label"
        />
      )}
      {notIncluded.length > 0 ? (
        <NotIncludedSection
          threads={notIncluded}
          events={events}
          forceOpen={included.length === 0}
        />
      ) : null}
    </div>
  );
}

function AssessStandardsOption({
  checked,
  enabled,
  onCheckedChange,
}: {
  checked: boolean;
  /** False when the Project has no Coding standards doc. */
  enabled: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const reasonId = "submit-assess-standards-reason";
  return (
    <div className="flex flex-col gap-1">
      <label
        className={cn(
          "flex items-start gap-2.5 text-sm font-medium",
          enabled ? "cursor-pointer" : "cursor-not-allowed",
        )}
      >
        <Checkbox
          checked={checked}
          disabled={!enabled}
          aria-describedby={enabled ? undefined : reasonId}
          data-testid="submit-assess-standards"
          className="mt-0.5"
          onCheckedChange={(value) => onCheckedChange(value === true)}
        />
        <span className={enabled ? "text-foreground" : "text-muted-foreground"}>
          Assess feedback for coding-standards gaps
        </span>
      </label>
      {enabled ? null : (
        <p id={reasonId} data-testid="submit-assess-standards-reason" className="pl-6 text-xs text-muted-foreground">
          This project has no {SUPPORTING_DOC_KEY_LABELS.codingStandards} doc.
        </p>
      )}
    </div>
  );
}

export function SubmitReviewDialog({
  open,
  storyId,
  reviewId,
  includedThreads,
  notIncludedThreads,
  destination,
  onDestinationChange,
  summary,
  onSummaryChange,
  assessStandards,
  hasCodingStandards,
  onAssessStandardsChange,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  /** The source Story; without one, a new idea is the only destination. */
  storyId: string | undefined;
  reviewId: string;
  includedThreads: readonly CommentThread[];
  notIncludedThreads: readonly CommentThread[];
  destination: ReviewSubmitDestination;
  onDestinationChange: (destination: ReviewSubmitDestination) => void;
  summary: string;
  onSummaryChange: (summary: string) => void;
  assessStandards: boolean;
  /** True when the Project has a coding-standards doc. Undefined while that is still loading. */
  hasCodingStandards: boolean | undefined;
  onAssessStandardsChange: (assessStandards: boolean) => void;
  onOpenChange: (open: boolean) => void;
  onSubmit: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="submit-review-dialog"
        aria-describedby={undefined}
        className="flex max-h-[min(calc(100dvh-2rem),40rem)] flex-col overflow-hidden"
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>Submit review</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-y-contain">
          <div role="radiogroup" aria-label="Submit to" className="flex min-w-0 flex-col gap-2">
            {storyId ? (
              <DestinationOption
                value="story"
                selected={destination === "story"}
                onSelect={onDestinationChange}
              >
                Submit as tasks to <span className="font-mono">{storyId}</span>
              </DestinationOption>
            ) : null}
            <DestinationOption
              value="idea"
              selected={destination === "idea"}
              onSelect={onDestinationChange}
            >
              Submit as a new idea
            </DestinationOption>
          </div>
          {storyId && hasCodingStandards !== undefined ? (
            <AssessStandardsOption
              checked={assessStandards}
              enabled={hasCodingStandards}
              onCheckedChange={onAssessStandardsChange}
            />
          ) : null}
          <DialogField>
            <Label htmlFor="submit-review-summary">Summary comment (optional)</Label>
            <Textarea
              id="submit-review-summary"
              value={summary}
              data-testid="submit-review-summary"
              onChange={(event) => onSummaryChange(event.target.value)}
            />
          </DialogField>
          <ThreadsToSubmit
            included={includedThreads}
            notIncluded={notIncludedThreads}
            reviewId={reviewId}
          />
        </div>
        <DialogFooter className="shrink-0 border-t border-border pt-3">
          <Button type="button" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            data-testid="submit-review-confirm"
            disabled={includedThreads.length === 0}
            onClick={onSubmit}
          >
            Submit review
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
