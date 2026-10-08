import type { ReactNode } from "react";
import type { Comment } from "@server/schemas";
import { Badge } from "@/components/ui/badge";
import { READING_MEASURE_CLASS } from "@/components/page-shell";
import { roleFamilyCaption } from "@/features/pipeline/role-family";
import { cn } from "@/lib/utils/cn";

/** Human composer side; everything else is an agent/system turn. */
export function isHumanRole(role: string): boolean {
  return role === "human";
}

/** Author line and role chip for one comment header. */
export function commentHeaderLabels(
  role: string,
  name?: string,
): { author: string; roleBadge: string } {
  if (isHumanRole(role)) {
    return { author: name ?? role, roleBadge: "Human" };
  }
  const caption = roleFamilyCaption(role).caption;
  return { author: name ?? caption, roleBadge: caption };
}

export function formatCommentTime(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return at;
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "on GitHub" link. Same classes as the pull-request comment link. */
export function GitHubCommentLink({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="text-primary hover:underline"
      data-testid="comment-github-link"
    >
      on GitHub
    </a>
  );
}

/** Shared comment header: author, role badge, time. */
export function CommentHeader({
  author,
  roleBadge,
  at,
  leading,
  extra,
  source,
  status,
}: {
  author: string;
  roleBadge: string;
  at: string;
  leading?: ReactNode;
  /** Sits in the header row after the role badge (status chips, session marks). */
  extra?: ReactNode;
  /** GitHub mirror provenance. Renders the "on GitHub" link after the role badge. */
  source?: Comment["source"];
  /** Trails the time. */
  status?: ReactNode;
}) {
  const time = formatCommentTime(at);
  const githubUrl = source?.kind === "github" ? source.url : undefined;
  return (
    <header className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
      {leading}
      <span className="font-medium text-foreground/80">{author}</span>
      <Badge
        variant="secondary"
        data-testid="comment-role-badge"
        className="uppercase tracking-[0.08em]"
      >
        {roleBadge}
      </Badge>
      {extra}
      {githubUrl ? <GitHubCommentLink url={githubUrl} /> : null}
      {time ? <time dateTime={at}>{time}</time> : null}
      {status}
    </header>
  );
}

export function Message({
  author,
  roleBadge,
  at,
  source,
  status,
  children,
}: {
  author: string;
  roleBadge: string;
  at: string;
  source?: Comment["source"];
  /** Trails the time in the header. */
  status?: ReactNode;
  children: ReactNode;
}) {
  return (
    <article className="flex flex-col gap-1.5 border-b border-border py-3 last:border-b-0">
      <CommentHeader
        author={author}
        roleBadge={roleBadge}
        at={at}
        source={source}
        status={status}
      />
      <div className={cn("min-w-0", READING_MEASURE_CLASS)}>{children}</div>
    </article>
  );
}
