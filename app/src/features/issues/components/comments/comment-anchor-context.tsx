import { FileCode2, FileDiff } from "lucide-react";
import type { ReactNode } from "react";
import type { CommentMessage } from "@server/schemas";
import { isLineAnchor } from "../../lib/comment-anchor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { useIssueChangeFileQuery } from "../../api/queries";
import { snippetLinesFromContents } from "../../lib/comment-anchor-snippet";
import { formatAnchorLineLabel } from "../../lib/comment-threads";

const SEE_IN_DIFF_LABEL = "See in diff";

export function CommentAnchorMeta({
  anchor,
  outdated,
  onSeeInDiff,
  showLocation = true,
  badges,
}: {
  anchor: NonNullable<CommentMessage["anchor"]>;
  outdated: boolean;
  onSeeInDiff?: () => void;
  showLocation?: boolean;
  /** Status chips (question, dismissed) in this header row, beside outdated. */
  badges?: ReactNode;
}) {
  const lineAnchor = isLineAnchor(anchor);
  return (
    <header
      data-testid="comment-anchor-meta"
      className="flex min-w-0 flex-nowrap items-center gap-x-2 pb-1.5 font-mono text-[10px] text-muted-foreground"
    >
      {showLocation ? (
        <>
          {lineAnchor ? null : (
            <span
              data-testid="file-comment-label"
              className="shrink-0 font-sans text-muted-foreground"
            >
              File comment
            </span>
          )}
          <FileCode2 className="h-3 w-3 shrink-0" aria-hidden />
          <span className="min-w-0 shrink truncate text-foreground/85 [direction:rtl] [text-align:left] shell:[direction:ltr]">
            {anchor.path}
          </span>
          {lineAnchor ? (
            <>
              <span className="shrink-0" aria-hidden>·</span>
              <span className="shrink-0 tabular-nums">
                {formatAnchorLineLabel(anchor)}
              </span>
            </>
          ) : null}
        </>
      ) : null}
      {outdated ? (
        <Badge variant="warn" className="shrink-0 uppercase tracking-[0.08em]">
          outdated
        </Badge>
      ) : null}
      {badges}
      {onSeeInDiff ? (
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          className="ml-auto shrink-0"
          title={SEE_IN_DIFF_LABEL}
          aria-label={SEE_IN_DIFF_LABEL}
          data-testid="see-in-diff"
          onClick={onSeeInDiff}
        >
          <FileDiff className="h-3.5 w-3.5" aria-hidden />
        </Button>
      ) : null}
    </header>
  );
}

export function CommentAnchorSnippet({
  issueId,
  anchor,
}: {
  issueId: string;
  anchor: NonNullable<CommentMessage["anchor"]>;
}) {
  const lineAnchor = isLineAnchor(anchor) ? anchor : undefined;
  const { data: contents } = useIssueChangeFileQuery(
    issueId,
    lineAnchor?.commitSha,
    lineAnchor?.path,
  );
  if (!lineAnchor || contents == null) return null;
  const lines = snippetLinesFromContents(contents, lineAnchor);
  if (lines.length === 0) return null;

  return (
    <div
      data-testid="comment-anchor-snippet"
      aria-label="Anchored diff context"
      className="-mx-3 mb-1 border-b border-border bg-muted/30"
    >
      <div className="overflow-x-auto font-mono text-[10px] leading-[1.55]">
        {lines.map((line) => (
          <div
            key={line.line}
            data-snippet-line={line.line}
            data-anchored={line.anchored ? "" : undefined}
            className={cn(
              "grid min-w-min grid-cols-[2.25rem_2.25rem_1.25rem_minmax(max-content,1fr)]",
              line.anchored &&
                "bg-[hsl(var(--current)/0.12)] shadow-[inset_2px_0_0_hsl(var(--current))]",
            )}
          >
            <span className="select-none px-1.5 text-right tabular-nums text-muted-foreground/70">
              {lineAnchor.side === "old" ? line.line : ""}
            </span>
            <span className="select-none px-1.5 text-right tabular-nums text-muted-foreground/70">
              {lineAnchor.side === "new" ? line.line : ""}
            </span>
            <span className="select-none text-center text-muted-foreground/70">
              {" "}
            </span>
            <span className="whitespace-pre pr-3">{line.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
