import type { ReactNode } from "react";
import { GitBranch } from "lucide-react";
import { Link } from "react-router-dom";
import { issuePath } from "@/features/issues/lib/links";

export function ReviewIdentity({
  title,
  id,
  missing,
}: {
  title: string;
  id: string;
  missing?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
      <span
        className={
          missing
            ? "truncate font-medium text-[hsl(var(--blocked))]"
            : "truncate font-medium text-foreground"
        }
      >
        {title}
      </span>
      <span className="font-mono text-xs tabular-nums text-muted-foreground">{id}</span>
    </div>
  );
}

/** Stays in the row when there is no Story, so titles still line up. */
export function ReviewStorySlot({
  projectId,
  storyId,
}: {
  projectId: string;
  storyId: string | undefined;
}) {
  return (
    <span
      className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center"
      data-testid="review-row-story-slot"
    >
      {storyId ? (
        <Link
          to={issuePath(projectId, storyId)}
          aria-label={`Story ${storyId}`}
          title={`Story ${storyId}`}
          data-testid="review-row-story-link"
          className="-m-1 inline-flex rounded-sm p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <GitBranch className="h-3.5 w-3.5" aria-hidden />
        </Link>
      ) : null}
    </span>
  );
}

export function ReviewRowIdentity({
  projectId,
  storyId,
  children,
}: {
  projectId: string;
  storyId: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-start gap-2">
      <ReviewStorySlot projectId={projectId} storyId={storyId} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
