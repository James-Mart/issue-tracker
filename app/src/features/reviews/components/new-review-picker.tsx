import { useDeferredValue, useState } from "react";
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
import { useOpenReview, useOpenReviewFromPr } from "../api/mutations";
import { ApiError } from "@/lib/api/errors";
import { useReviewCandidatesQuery } from "../api/queries";
import { useGoToReviewIssue } from "../hooks/use-go-to-review-issue";
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

function prLoadFault(error: Error): { message: string; hint: string } {
  const body =
    error instanceof ApiError && error.body && typeof error.body === "object"
      ? (error.body as { code?: unknown; origin?: unknown })
      : undefined;
  if (body?.code === "pr-not-found") {
    return {
      message: "Pull request not found on GitHub.",
      hint: "Check the URL or number, or confirm the PR is still open.",
    };
  }
  if (body?.code === "pr-wrong-repository") {
    const origin = typeof body.origin === "string" ? body.origin : "the project origin";
    return {
      message: "That pull request belongs to a different repository.",
      hint: `This project tracks origin ${origin}. The PR targets another repo.`,
    };
  }
  return {
    message: error.message,
    hint: "Check the pull request, then try again.",
  };
}

export function NewReviewPicker({
  projectId,
  projectTitle,
}: {
  projectId: string;
  projectTitle: string;
}) {
  const goToReview = useGoToReviewIssue(projectId);
  const openReview = useOpenReview(projectId);
  const openPr = useOpenReviewFromPr(projectId);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [prInput, setPrInput] = useState("");
  const deferredQuery = useDeferredValue(query);
  const candidates = useReviewCandidatesQuery(projectId, deferredQuery, { enabled: open });
  const stories = candidates.data?.stories ?? [];
  const pendingId = openReview.isPending ? openReview.variables : undefined;
  const busy = pendingId !== undefined || openPr.isPending;

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setQuery("");
      setPrInput("");
      openPr.reset();
    }
  };

  const loadPr = () => {
    const pr = prInput.trim();
    if (!pr || busy) return;
    void openPr.mutateAsync(pr)
      .then((opened) => {
        setOpen(false);
        goToReview(opened.reviewId);
      })
      .catch(() => undefined);
  };

  const choose = (storyId: string) => {
    void openReview.mutateAsync(storyId).then(
      (review) => {
        setOpen(false);
        goToReview(review.id);
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
              Load a GitHub pull request for this project, or pick a Story in{" "}
              {projectTitle} — including merged Stories for a post-mortem.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              loadPr();
            }}
          >
            <DialogField>
              <Label htmlFor="new-review-pr">GitHub pull request</Label>
              <div className="flex gap-2">
                <Input
                  id="new-review-pr"
                  data-testid="new-review-pr"
                  value={prInput}
                  placeholder="Paste URL or number…"
                  autoComplete="off"
                  className="min-w-0 flex-1 touch:h-11"
                  onChange={(event) => {
                    setPrInput(event.target.value);
                    if (openPr.isError) openPr.reset();
                  }}
                />
                <Button
                  type="submit"
                  className="shrink-0"
                  disabled={busy || prInput.trim() === ""}
                  data-testid="new-review-load-pr"
                >
                  Load PR
                </Button>
              </div>
            </DialogField>
          </form>
          {openPr.error ? (
            <div data-testid="new-review-pr-error">
              <ShellInlineFault {...prLoadFault(openPr.error)} />
            </div>
          ) : null}
          <DialogField>
            <Label htmlFor="new-review-search">Or pick a Story</Label>
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
                    disabled={busy}
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
