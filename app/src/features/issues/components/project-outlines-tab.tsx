import { useMemo, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { ShellInlineFault, ShellLoadingState, ShellState } from "@/app/shell-state";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";
import { useIssuesIncludingArchived } from "../hooks/use-issues-with-archived";
import {
  type IssueBackLocationState,
  issueBackNavigateState,
} from "../lib/issue-back";
import { issuePath } from "../lib/links";
import {
  outlineVersionLabel,
  outlinesForProject,
  PROJECT_OUTLINES_EMPTY_DETAIL,
  PROJECT_OUTLINES_EMPTY_TITLE,
  PROJECT_OUTLINES_LINKED_ROOTS_LABEL,
  type OutlineRecord,
} from "../lib/project-outlines";
import { useIssueUiStore } from "../store/use-issue-ui-store";
import { SETTINGS_HEADING_CLASS } from "./detail-section";

const ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-1 shell:grid-cols-[minmax(0,1fr)_5.5rem_7.5rem_1rem] shell:gap-x-4";

/**
 * Project detail catalog: every outline under the Project, newest version
 * first. A row opens that outline's detail page.
 */
export function ProjectOutlinesTab({ projectId }: { projectId: string }) {
  const showArchived = useIssueUiStore((state) => state.showArchived);
  const query = useIssuesIncludingArchived(showArchived);
  const outlines = useMemo(() => {
    if (!query.data) return [];
    return outlinesForProject(query.data.issues, projectId, showArchived);
  }, [projectId, query.data, showArchived]);
  const location = useLocation();
  const linkState = issueBackNavigateState(
    location.pathname,
    location.search,
    (location.state as IssueBackLocationState | null)?.issueBackStack,
  );

  let body: ReactNode;
  if (query.error) {
    body = (
      <ShellInlineFault
        message={query.error.message}
        hint="Reload the page or try again in a moment."
      />
    );
  } else if (!query.data) {
    body = <ShellLoadingState label="Loading outlines…" />;
  } else if (outlines.length === 0) {
    body = (
      <ShellState
        title={PROJECT_OUTLINES_EMPTY_TITLE}
        detail={PROJECT_OUTLINES_EMPTY_DETAIL}
      />
    );
  } else {
    body = (
      <Card className="px-4 py-3.5">
        <div
          className={cn(
            ROW_GRID,
            "mb-1 hidden border border-transparent border-b-border pb-1 shell:grid",
          )}
          aria-hidden="true"
        >
          <span className={SETTINGS_HEADING_CLASS}>Title</span>
          <span className={cn(SETTINGS_HEADING_CLASS, "text-right")}>Version</span>
          <span className={cn(SETTINGS_HEADING_CLASS, "text-right")}>
            Linked work
          </span>
          <span />
        </div>
        <ul className="flex list-none flex-col divide-y divide-border p-0">
          {outlines.map((outline) => (
            <li key={outline.id}>
              <OutlineCatalogRow
                outline={outline}
                projectId={projectId}
                linkState={linkState}
              />
            </li>
          ))}
        </ul>
      </Card>
    );
  }

  return <div data-testid="project-outlines-tab">{body}</div>;
}

function OutlineCatalogRow({
  outline,
  projectId,
  linkState,
}: {
  outline: OutlineRecord;
  projectId: string;
  linkState: ReturnType<typeof issueBackNavigateState>;
}) {
  const version = outlineVersionLabel(outline.bodyVersion);
  const linked = PROJECT_OUTLINES_LINKED_ROOTS_LABEL;
  return (
    <Link
      to={issuePath(projectId, outline.id)}
      state={linkState}
      data-testid={`project-outline-row-${outline.id}`}
      className={cn(
        ROW_GRID,
        "rounded-md border border-transparent py-2.5 text-foreground hover:border-[hsl(var(--rail-lit))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <span className="min-w-0">
        <span className="block truncate font-medium">{outline.title}</span>
        <span className="mt-0.5 block font-mono text-xs tabular-nums text-muted-foreground shell:hidden">
          {`${version} · ${linked}`}
        </span>
      </span>
      <span className="hidden text-right font-mono text-xs tabular-nums text-muted-foreground shell:block">
        {version}
      </span>
      <span className="hidden text-right font-mono text-xs tabular-nums text-muted-foreground shell:block">
        {linked}
      </span>
      <ChevronRight
        aria-hidden="true"
        className="h-4 w-4 justify-self-end text-muted-foreground"
      />
    </Link>
  );
}
