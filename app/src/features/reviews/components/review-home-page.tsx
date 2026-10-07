import { useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import type { IssueRecord, ReviewProgress, ReviewRecordView } from "@server/schemas";
import {
  IssuesQueryShell,
  ShellFaultDetail,
  ShellState,
} from "@/app/shell-state";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { ProjectLensSwitcher } from "@/features/issues/components/project-lens-switcher";
import { useIssuesQuery } from "@/features/issues/api/queries";
import { useOpenReview, useReopenReview } from "../api/mutations";
import { useReviewProgressQuery, useReviewsQuery } from "../api/queries";
import { storyReviewPath } from "../lib/links";
import { NewReviewPicker } from "./new-review-picker";
import { ReviewIdentity } from "./review-identity";
import { ReviewProgressFault } from "./review-progress-fault";
import {
  archivedReviewMeta,
  archivedReviewPendingMeta,
  openReviewMeta,
  openReviewPendingMeta,
  readyReviewMeta,
  reviewHomeLists,
  type ReviewHomeArchived,
  type ReviewHomeReady,
  type ReviewHomeReview,
  type ReviewMetaPart,
} from "../lib/review-home-lists";

function ReviewHomeHeader({ title }: { title: string }) {
  return (
    <header className="min-w-0">
      <p className="font-display text-[11px] font-semibold uppercase tracking-[0.22em] text-[hsl(var(--current))]">
        Code review
      </p>
      <h1 className="truncate text-base font-semibold tracking-tight text-foreground">
        {title}
      </h1>
    </header>
  );
}

function SectionHeading({ id, label, count }: { id: string; label: string; count: number }) {
  return (
    <h2
      id={id}
      className="font-display text-[11px] font-semibold uppercase tracking-[0.16em] text-[hsl(var(--current))]"
    >
      {label}
      <span className="ml-2 font-mono text-[11px] tabular-nums text-muted-foreground">
        {count}
      </span>
    </h2>
  );
}

function partClass(tone: ReviewMetaPart["tone"]): string | undefined {
  if (tone === "mono") return "font-mono tabular-nums";
  if (tone === "warn") return "text-[hsl(var(--warn))]";
  return undefined;
}

function MetaLine({ clauses }: { clauses: ReviewMetaPart[][] }) {
  return (
    <p className="mt-0.5 flex flex-wrap text-xs text-muted-foreground">
      {clauses.map((clause, index) => (
        <span key={index} className="whitespace-nowrap">
          {index > 0 ? " · " : null}
          {clause.map((part) => (
            <span key={part.text} className={partClass(part.tone)}>
              {part.text}
            </span>
          ))}
        </span>
      ))}
    </p>
  );
}

function useReviewHomeProgress(
  projectId: string,
  review: ReviewRecordView,
  pending: ReviewMetaPart[][],
  loaded: (progress: ReviewProgress) => ReviewMetaPart[][],
) {
  const progress = useReviewProgressQuery(projectId, review.id);
  return {
    clauses: progress.data ? loaded(progress.data) : pending,
    error: progress.error,
  };
}

function OpenReviewRow({
  projectId,
  item,
}: {
  projectId: string;
  item: ReviewHomeReview;
}) {
  const storyId = item.review.target.storyId;
  const { clauses, error } = useReviewHomeProgress(
    projectId,
    item.review,
    openReviewPendingMeta(item.review.updatedAt),
    (progress) => openReviewMeta(item.review, progress),
  );
  return (
    <li className="rounded-lg border border-border bg-card hover:border-[hsl(var(--rail-lit))]">
      <Link
        to={storyReviewPath(projectId, storyId)}
        data-testid="review-home-open-row"
        className="block rounded-lg px-3 py-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ReviewIdentity
          title={item.story?.title ?? "Story missing"}
          id={storyId}
          missing={!item.story}
        />
        <MetaLine clauses={clauses} />
      </Link>
      {error ? (
        <div className="px-3 pb-2.5">
          <ReviewProgressFault />
        </div>
      ) : null}
    </li>
  );
}

function ReadyReviewRow({
  ready,
  starting,
  onStart,
}: {
  ready: ReviewHomeReady;
  starting: boolean;
  onStart: () => void;
}) {
  const { story, taskCount } = ready;

  return (
    <li
      data-testid="review-home-ready-row"
      className="flex flex-col gap-3 rounded-lg border border-border bg-card px-3 py-2.5 shell:flex-row shell:items-center"
    >
      <div className="min-w-0 flex-1">
        <ReviewIdentity title={story.title} id={story.id} />
        <MetaLine clauses={readyReviewMeta(taskCount, story.updatedAt)} />
      </div>
      <Button
        type="button"
        size="sm"
        className="shrink-0 self-start shell:self-center"
        disabled={starting}
        data-testid="review-home-start"
        onClick={onStart}
      >
        Start review
      </Button>
    </li>
  );
}

function ArchivedReviewRow({
  projectId,
  item,
  reopening,
  onReopen,
}: {
  projectId: string;
  item: ReviewHomeArchived;
  reopening: boolean;
  onReopen: () => void;
}) {
  const storyId = item.review.target.storyId;
  const { clauses, error } = useReviewHomeProgress(
    projectId,
    item.review,
    archivedReviewPendingMeta(item.review),
    (progress) => archivedReviewMeta(item.review, progress),
  );

  return (
    <li
      data-testid="review-home-archived-row"
      className="flex flex-col gap-3 rounded-lg border border-border bg-card px-3 py-2.5 shell:flex-row shell:items-center"
    >
      <div className="min-w-0 flex-1">
        <Link
          to={storyReviewPath(projectId, storyId)}
          className="block rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ReviewIdentity
            title={item.story?.title ?? "Story missing"}
            id={storyId}
            missing={!item.story}
          />
        </Link>
        <MetaLine clauses={clauses} />
        {error ? <ReviewProgressFault /> : null}
      </div>
      <Button
        type="button"
        size="sm"
        className="shrink-0 self-start shell:self-center"
        disabled={reopening}
        data-testid="review-home-reopen"
        onClick={onReopen}
      >
        Reopen
      </Button>
    </li>
  );
}

function ReviewHomeLists({
  projectId,
  issues,
  reviews,
}: {
  projectId: string;
  issues: IssueRecord[];
  reviews: ReviewRecordView[];
}) {
  const open = useOpenReview(projectId);
  const reopen = useReopenReview(projectId);
  const navigate = useNavigate();
  const lists = useMemo(
    () => reviewHomeLists(projectId, issues, reviews),
    [issues, projectId, reviews],
  );

  const startReview = (storyId: string) => {
    void open.mutateAsync(storyId).then(
      () => navigate(storyReviewPath(projectId, storyId)),
      () => {
        // useOpenReview toasts the failure; stay on the landing page.
      },
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="review-home-open-heading" className="flex flex-col gap-2">
        <SectionHeading
          id="review-home-open-heading"
          label="Open reviews"
          count={lists.open.length}
        />
        {lists.open.length === 0 ? (
          <ShellState
            title="No open reviews"
            detail="Reviews archive when their Story merges, or when you archive them. Start one from Ready for review."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {lists.open.map((item) => (
              <OpenReviewRow
                key={item.review.id}
                projectId={projectId}
                item={item}
              />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="review-home-ready-heading" className="flex flex-col gap-2">
        <SectionHeading
          id="review-home-ready-heading"
          label="Ready for review"
          count={lists.ready.length}
        />
        {lists.ready.length === 0 ? (
          <ShellState
            title="Nothing ready for review"
            detail="Stories appear here when every Task is done and no review exists yet."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {lists.ready.map((ready) => (
              <ReadyReviewRow
                key={ready.story.id}
                ready={ready}
                starting={open.isPending && open.variables === ready.story.id}
                onStart={() => startReview(ready.story.id)}
              />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="review-home-archived-heading">
        <details data-testid="review-home-archived" className="group">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 marker:content-none [&::-webkit-details-marker]:hidden">
            <ChevronRight
              aria-hidden
              className="h-3.5 w-3.5 shrink-0 text-muted-foreground motion-safe:transition-transform group-open:rotate-90"
            />
            <SectionHeading
              id="review-home-archived-heading"
              label="Archived"
              count={lists.archived.length}
            />
          </summary>
          <div className="mt-2">
            {lists.archived.length === 0 ? (
              <ShellState
                title="No archived reviews"
                detail="Merged Stories and manually archived reviews land here."
              />
            ) : (
              <ul className="flex flex-col gap-2">
                {lists.archived.map((item) => (
                  <ArchivedReviewRow
                    key={item.review.id}
                    projectId={projectId}
                    item={item}
                    reopening={reopen.isPending && reopen.variables === item.review.id}
                    onReopen={() => reopen.mutate(item.review.id)}
                  />
                ))}
              </ul>
            )}
          </div>
        </details>
      </section>
    </div>
  );
}

export function ReviewHomePage() {
  const { projectId = "" } = useParams();
  const issuesQuery = useIssuesQuery();
  const reviewsQuery = useReviewsQuery(projectId);
  const issues = issuesQuery.data?.issues ?? [];
  const reviews = reviewsQuery.data?.reviews ?? [];
  const project = issues.find(
    (issue) => issue.id === projectId && issue.kind === "project",
  );
  const loading =
    (issuesQuery.isLoading && !issuesQuery.data) ||
    (reviewsQuery.isLoading && !reviewsQuery.data);

  return (
    <IssuesQueryShell
      isLoading={loading}
      error={issuesQuery.error ?? reviewsQuery.error}
      isFetching={issuesQuery.isFetching || reviewsQuery.isFetching}
      onReload={() => {
        void issuesQuery.refetch();
        void reviewsQuery.refetch();
      }}
      loadingLabel="Loading code review…"
      errorTitle="Couldn't load code review."
    >
      {!project ? (
        <PageShell>
          <ReviewHomeHeader title="Project not found" />
          <ShellState
            tone="blocked"
            eyebrow="Missing"
            title="No project with that id."
            detail={
              <ShellFaultDetail
                message={projectId || "(no id in the URL)"}
                hint="It may have been renamed or deleted. Pick a project from the Cockpit."
              />
            }
            action={
              <Button asChild size="sm" variant="primary">
                <Link to="/">Back to Cockpit</Link>
              </Button>
            }
          />
        </PageShell>
      ) : (
        <PageShell data-testid="review-home-page">
          <div className="flex items-start justify-between gap-3">
            <ReviewHomeHeader title={project.title} />
            <NewReviewPicker projectId={projectId} projectTitle={project.title} />
          </div>
          <ProjectLensSwitcher projectId={projectId} active="review" />
          <ReviewHomeLists
            projectId={projectId}
            issues={issues}
            reviews={reviews}
          />
        </PageShell>
      )}
    </IssuesQueryShell>
  );
}
