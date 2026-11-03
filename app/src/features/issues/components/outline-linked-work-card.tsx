import { useMemo } from "react";
import { ChevronRight } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import type { IssueDetail } from "@server/schemas";
import { ShellInlineFault, ShellState } from "@/app/shell-state";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils/cn";
import { useIssuesIncludingArchived } from "../hooks/use-issues-with-archived";
import {
  type IssueBackLocationState,
  issueBackNavigateState,
} from "../lib/issue-back";
import { KIND_LABEL } from "../lib/kind";
import { issuePath } from "../lib/links";
import {
  linkedRootsForOutline,
  type LinkedRoot,
} from "../lib/outline-links";
import { outlineVersionLabel } from "../lib/project-outlines";
import { useIssueUiStore } from "../store/use-issue-ui-store";
import { AxisChips, BEHIND_AXIS_CHIP } from "./axis-chips";
import { DetailEyebrow, SETTINGS_HEADING_CLASS } from "./detail-section";

const ROW_GRID =
  "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 shell:grid-cols-[5.5rem_minmax(0,1fr)_4.5rem_6.5rem] shell:gap-x-4";

/**
 * Roots built from this outline: kind, title, stamped version, and `behind`.
 * Sits above the body card in every outline state.
 */
export function OutlineLinkedWorkCard({
  issue,
}: {
  issue: Extract<IssueDetail, { kind: "outline" }>;
}) {
  const showArchived = useIssueUiStore((state) => state.showArchived);
  const query = useIssuesIncludingArchived(showArchived);
  const roots = useMemo(() => {
    if (!query.data) return [];
    return linkedRootsForOutline(
      query.data.issues,
      query.data.derived,
      issue.id,
      showArchived,
    );
  }, [issue.id, query.data, showArchived]);
  const location = useLocation();
  const linkState = issueBackNavigateState(
    location.pathname,
    location.search,
    (location.state as IssueBackLocationState | null)?.issueBackStack,
  );

  let body;
  if (query.error) {
    body = (
      <ShellInlineFault
        message={query.error.message}
        hint="Reload the page or try again in a moment."
      />
    );
  } else if (!query.data) {
    body = (
      <p role="status" className="font-mono text-[11px] text-muted-foreground">
        Loading linked work…
      </p>
    );
  } else if (roots.length === 0) {
    body = (
      <div data-testid="outline-linked-work-empty">
        <ShellState
          className="border-0 bg-transparent px-2 py-6 shadow-none"
          title="No roots decomposed yet"
        />
      </div>
    );
  } else {
    body = (
      <>
        <div
          className={cn(
            ROW_GRID,
            "mb-1 hidden border border-transparent border-b-border pb-1 shell:grid",
          )}
          aria-hidden="true"
        >
          <span className={SETTINGS_HEADING_CLASS}>Kind</span>
          <span className={SETTINGS_HEADING_CLASS}>Title</span>
          <span className={cn(SETTINGS_HEADING_CLASS, "text-right")}>
            Version
          </span>
          <span className={cn(SETTINGS_HEADING_CLASS, "text-right")}>
            Status
          </span>
        </div>
        <ul className="flex list-none flex-col divide-y divide-border p-0">
          {roots.map((root) => (
            <li key={root.id}>
              <LinkedRootRow
                root={root}
                projectId={issue.partOf}
                linkState={linkState}
              />
            </li>
          ))}
        </ul>
      </>
    );
  }

  return (
    <section
      className="rounded-lg border border-border bg-card p-5"
      data-testid="outline-linked-work"
    >
      <DetailEyebrow className="mb-3">Linked work</DetailEyebrow>
      {body}
    </section>
  );
}

function LinkedRootRow({
  root,
  projectId,
  linkState,
}: {
  root: LinkedRoot;
  projectId: string;
  linkState: ReturnType<typeof issueBackNavigateState>;
}) {
  const version = outlineVersionLabel(root.version);
  return (
    <Link
      to={issuePath(projectId, root.id)}
      state={linkState}
      data-testid={`outline-linked-root-${root.id}`}
      className={cn(
        ROW_GRID,
        "rounded-md border border-transparent py-2.5 text-foreground hover:border-[hsl(var(--rail-lit))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <Badge
        variant="outline"
        className="justify-self-start font-mono text-[10px] uppercase tracking-[0.08em]"
      >
        {KIND_LABEL[root.kind]}
      </Badge>
      <span className="min-w-0">
        <span className="block truncate font-medium">{root.title}</span>
        <span className="mt-0.5 block font-mono text-xs tabular-nums text-muted-foreground shell:hidden">
          {version}
        </span>
      </span>
      <span className="hidden text-right font-mono text-xs tabular-nums text-muted-foreground shell:block">
        {version}
      </span>
      <span className="flex items-center justify-end gap-2">
        {root.behind ? (
          <AxisChips chips={[BEHIND_AXIS_CHIP]} />
        ) : null}
        <ChevronRight
          aria-hidden="true"
          className="h-4 w-4 text-muted-foreground shell:hidden"
        />
      </span>
    </Link>
  );
}
