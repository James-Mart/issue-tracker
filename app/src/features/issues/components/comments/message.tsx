import type { ReactNode } from "react";
import { Bot } from "lucide-react";
import type { Comment } from "@server/schemas";
import { CommentGitHubIcon } from "./comment-github-icon";
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
): { author: string; roleBadge?: string } {
  if (isHumanRole(role)) {
    // Unnamed human comments show "Human" on the author line (no role badge).
    const author = name?.trim() || "Human";
    return { author };
  }
  if (role === "github-bot") {
    return { author: name?.trim() || "Bot", roleBadge: "Bot" };
  }
  const caption = roleFamilyCaption(role).caption;
  return { author: name?.trim() || caption, roleBadge: caption };
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

/** Bot mark for a comment authored by a GitHub bot. The login is the author. */
export function CommentBotIcon() {
  return (
    <Bot
      className="h-3.5 w-3.5 shrink-0"
      aria-hidden
      data-testid="comment-bot-icon"
    />
  );
}

const VIEW_ON_GITHUB = "View on GitHub";

/** GitHub mirror provenance. Icon-only link to the source comment on GitHub. */
export function GitHubCommentLink({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex shrink-0 rounded-sm text-primary hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid="comment-github-link"
      aria-label={VIEW_ON_GITHUB}
      title={VIEW_ON_GITHUB}
    >
      <CommentGitHubIcon />
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
  roleBadge?: string;
  at: string;
  leading?: ReactNode;
  /** Sits in the header row after the role badge (status chips, session marks). */
  extra?: ReactNode;
  /** GitHub mirror provenance. Renders the GitHub icon link after the role badge. */
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
      {roleBadge ? (
        <Badge
          variant="secondary"
          data-testid="comment-role-badge"
          className="uppercase tracking-[0.08em]"
        >
          {roleBadge}
        </Badge>
      ) : null}
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
  leading,
  status,
  children,
}: {
  author: string;
  roleBadge?: string;
  at: string;
  source?: Comment["source"];
  leading?: ReactNode;
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
        leading={leading}
        source={source}
        status={status}
      />
      <div className={cn("min-w-0", READING_MEASURE_CLASS)}>{children}</div>
    </article>
  );
}
