import { useDeferredValue, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ReviewCandidate } from "@server/schemas";
import { ShellInlineFault } from "@/app/shell-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogField,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useOpenReview } from "../api/mutations";
import { useReviewCandidatesQuery } from "../api/queries";
import { storyReviewPath } from "../lib/links";
import { ReviewIdentity } from "./review-identity";

function CandidateChips({ story }: { story: ReviewCandidate }) {
  if (!story.merged && !story.reviewId) return null;
  return (
    <span className="flex flex-wrap gap-1.5">
      {story.merged ? <Badge variant="done">merged</Badge> : null}
      {story.reviewId ? <Badge variant="todo">has review</Badge> : null}
    </span>
  );
}

export function NewReviewPicker({
  projectId,
  projectTitle,
}: {
  projectId: string;
  projectTitle: string;
}) {
  const navigate = useNavigate();
  const openReview = useOpenReview(projectId);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const candidates = useReviewCandidatesQuery(projectId, deferredQuery, { enabled: open });
  const stories = candidates.data?.stories ?? [];
  const pendingId = openReview.isPending ? openReview.variables : undefined;

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setQuery("");
  };

  const choose = (storyId: string) => {
    void openReview.mutateAsync(storyId).then(
      () => {
        setOpen(false);
        navigate(storyReviewPath(projectId, storyId));
      },
      () => {
        // useOpenReview toasts the failure; the picker stays open.
      },
    );
  };

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="primary"
        className="shrink-0"
        data-testid="new-review-open"
        onClick={() => setOpen(true)}
      >
        New review
      </Button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          data-testid="new-review-picker"
          className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle>New review</DialogTitle>
            <DialogDescription>
              Pick any Story in {projectTitle} — including merged Stories for a
              post-mortem.
            </DialogDescription>
          </DialogHeader>
          <DialogField>
            <Label htmlFor="new-review-search">Search by title</Label>
            <Input
              id="new-review-search"
              data-testid="new-review-search"
              value={query}
              placeholder="Title"
              autoComplete="off"
              className="touch:h-11"
              onChange={(event) => setQuery(event.target.value)}
            />
          </DialogField>
          {candidates.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading stories…</p>
          ) : candidates.error ? (
            <ShellInlineFault
              message={candidates.error.message}
              hint="Change the search, or close and open the picker again."
            />
          ) : stories.length === 0 ? (
            <p role="status" className="text-sm text-muted-foreground">
              {deferredQuery === ""
                ? "No Stories with commits yet."
                : `No Stories with "${deferredQuery}" in the title.`}
            </p>
          ) : (
            <ul className="flex flex-col gap-2" aria-label="Stories">
              {stories.map((story) => (
                <li key={story.storyId}>
                  <button
                    type="button"
                    data-testid="new-review-candidate"
                    data-story-id={story.storyId}
                    disabled={pendingId !== undefined}
                    className="flex w-full min-w-0 flex-col items-start gap-1 rounded-lg border border-border bg-card px-3 py-2.5 text-left hover:border-[hsl(var(--rail-lit))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 touch:min-h-11"
                    onClick={() => choose(story.storyId)}
                  >
                    <ReviewIdentity title={story.title} id={story.storyId} />
                    <CandidateChips story={story} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
