import type { ReactNode } from "react";
import type { ReviewSubmitDestination } from "@server/schemas";
import { Button } from "@/components/ui/button";
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
import type { CommentThread } from "@/features/issues/lib/comment-threads";
import { cn } from "@/lib/utils/cn";
import { threadsToSubmitLabel } from "../lib/review-submission-ui";
import { reviewThreadExcerpt, reviewThreadLocation } from "../lib/review-thread-label";

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

function ThreadsToSubmit({ threads }: { threads: readonly CommentThread[] }) {
  return (
    <DialogField className="flex min-h-0 flex-1 flex-col">
      <p id="submit-review-threads" className="text-sm font-medium leading-none text-foreground">
        {threadsToSubmitLabel(threads.length)}
      </p>
      <ul
        aria-labelledby="submit-review-threads"
        data-testid="submit-review-threads"
        className="m-0 flex min-h-0 flex-1 list-none flex-col gap-2 overflow-y-auto overscroll-y-contain p-0"
      >
        {threads.map((thread) => (
          <li
            key={thread.root.id}
            className="flex min-w-0 flex-col gap-0.5 rounded-md border border-border px-3 py-2"
          >
            <span className="break-all font-mono text-xs tabular-nums text-muted-foreground">
              {reviewThreadLocation(thread.root.anchor)}
            </span>
            <span className="line-clamp-2 text-sm text-foreground">
              {reviewThreadExcerpt(thread.root.body)}
            </span>
          </li>
        ))}
      </ul>
    </DialogField>
  );
}

export function SubmitReviewDialog({
  open,
  storyId,
  threads,
  destination,
  onDestinationChange,
  summary,
  onSummaryChange,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  /** The source Story; without one, a new idea is the only destination. */
  storyId: string | undefined;
  threads: readonly CommentThread[];
  destination: ReviewSubmitDestination;
  onDestinationChange: (destination: ReviewSubmitDestination) => void;
  summary: string;
  onSummaryChange: (summary: string) => void;
  onOpenChange: (open: boolean) => void;
  onSubmit: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="submit-review-dialog"
        aria-describedby={undefined}
        className="flex max-h-[min(calc(100dvh-2rem),40rem)] flex-col"
      >
        <DialogHeader>
          <DialogTitle>Submit review</DialogTitle>
        </DialogHeader>
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
        <DialogField>
          <Label htmlFor="submit-review-summary">Summary comment (optional)</Label>
          <Textarea
            id="submit-review-summary"
            value={summary}
            data-testid="submit-review-summary"
            onChange={(event) => onSummaryChange(event.target.value)}
          />
        </DialogField>
        <ThreadsToSubmit threads={threads} />
        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            data-testid="submit-review-confirm"
            onClick={onSubmit}
          >
            Submit review
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
