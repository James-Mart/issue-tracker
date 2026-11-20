import { useMemo, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { FIELD_LABELS } from "@server/fields";
import { ShellInlineFault, ShellLoadingState, ShellState } from "@/app/shell-state";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";
import { useIssuesIncludingArchived } from "../hooks/use-issues-with-archived";
import {
  READY_TO_DECOMPOSE_BADGE_VARIANT,
  READY_TO_DECOMPOSE_LABEL,
} from "../lib/derived";
import {
  type IssueBackLocationState,
  issueBackNavigateState,
} from "../lib/issue-back";
import { issuePath } from "../lib/links";
import {
  outlineCatalogForProject,
  outlineVersionLabel,
  OUTLINE_CATALOG_IMPLEMENTATION_LABEL,
  PROJECT_OUTLINES_EMPTY_DETAIL,
  PROJECT_OUTLINES_EMPTY_TITLE,
  type OutlineRecord,
} from "../lib/project-outlines";
import { useIssueUiStore } from "../store/use-issue-ui-store";
import { DetailEyebrow, SETTINGS_HEADING_CLASS } from "./detail-section";

/**
 * Narrow: title and chevron. Desktop: title, status, version, linked work,
 * chevron — one line. Status fits the Ready to decompose badge, and linked
 * work is fixed, so an empty status cell does not shift the other columns.
 */
const ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-1 shell:grid-cols-[minmax(0,1fr)_11rem_5.5rem_12.5rem_1rem] shell:gap-x-4";

/**
 * Project detail catalog: outlines for implementation in the tracker, and
 * outlines implemented out of band. A linked root stays with implementation.
 * Newest version first within each list. A row opens that outline.
 */
export function ProjectOutlinesTab({ projectId }: { projectId: string }) {
  const showArchived = useIssueUiStore((state) => state.showArchived);
  const query = useIssuesIncludingArchived(showArchived);
  const listed = query.data;
  const catalog = useMemo(() => {
    if (!listed) return null;
    return outlineCatalogForProject(
      listed.issues,
      projectId,
      showArchived,
      listed.derived,
    );
  }, [projectId, listed, showArchived]);
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
  } else if (!listed) {
    body = <ShellLoadingState label="Loading outlines…" />;
  } else if (!catalog || catalog.outlines.length === 0) {
    body = (
      <ShellState
        title={PROJECT_OUTLINES_EMPTY_TITLE}
        detail={PROJECT_OUTLINES_EMPTY_DETAIL}
      />
    );
  } else {
    body = (
      <div className="flex flex-col gap-8">
        {catalog.bands.implementation.length > 0 ? (
          <OutlineCatalogSection
            title={OUTLINE_CATALOG_IMPLEMENTATION_LABEL}
            testId="project-outlines-implementation"
            outlines={catalog.bands.implementation}
            projectId={projectId}
            linkState={linkState}
            linkedLabels={catalog.labels}
            readyIds={catalog.readyIds}
          />
        ) : null}
        {catalog.bands.outOfBand.length > 0 ? (
          <OutlineCatalogSection
            title={FIELD_LABELS.outOfBand}
            testId="project-outlines-out-of-band"
            outlines={catalog.bands.outOfBand}
            projectId={projectId}
            linkState={linkState}
            linkedLabels={catalog.labels}
            readyIds={catalog.readyIds}
          />
        ) : null}
      </div>
    );
  }

  return <div data-testid="project-outlines-tab">{body}</div>;
}

function OutlineCatalogSection({
  title,
  testId,
  outlines,
  projectId,
  linkState,
  linkedLabels,
  readyIds,
}: {
  title: string;
  testId: string;
  outlines: OutlineRecord[];
  projectId: string;
  linkState: ReturnType<typeof issueBackNavigateState>;
  linkedLabels: Map<string, string>;
  readyIds: ReadonlySet<string>;
}) {
  return (
    <section data-testid={testId} className="flex min-w-0 flex-col gap-2.5">
      <DetailEyebrow>{title}</DetailEyebrow>
      <Card className="px-4 py-3.5">
        <div
          className={cn(
            ROW_GRID,
            "mb-1 hidden border border-transparent border-b-border pb-1 shell:grid",
          )}
          aria-hidden="true"
        >
          <span className={SETTINGS_HEADING_CLASS}>Title</span>
          <span className={cn(SETTINGS_HEADING_CLASS, "text-right")}>Status</span>
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
                linked={linkedLabels.get(outline.id) ?? "0 roots"}
                ready={readyIds.has(outline.id)}
              />
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}

function ReadyToDecomposeBadge() {
  return (
    <Badge
      variant={READY_TO_DECOMPOSE_BADGE_VARIANT}
      data-testid="project-outline-ready"
      className="whitespace-nowrap"
    >
      {READY_TO_DECOMPOSE_LABEL}
    </Badge>
  );
}

function OutlineCatalogRow({
  outline,
  projectId,
  linkState,
  linked,
  ready,
}: {
  outline: OutlineRecord;
  projectId: string;
  linkState: ReturnType<typeof issueBackNavigateState>;
  linked: string;
  ready: boolean;
}) {
  const version = outlineVersionLabel(outline.bodyVersion);
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
        {ready ? (
          <span className="mt-1.5 block shell:hidden">
            <ReadyToDecomposeBadge />
          </span>
        ) : null}
        <span className="mt-0.5 block font-mono text-xs tabular-nums text-muted-foreground shell:hidden">
          {`${version} · ${linked}`}
        </span>
      </span>
      <span className="hidden justify-self-end shell:block">
        {ready ? <ReadyToDecomposeBadge /> : null}
      </span>
      <span className="hidden text-right font-mono text-xs tabular-nums text-muted-foreground shell:block">
        {version}
      </span>
      <span className="hidden whitespace-nowrap text-right font-mono text-xs tabular-nums text-muted-foreground shell:block">
        {linked}
      </span>
      <ChevronRight
        aria-hidden="true"
        className="h-4 w-4 justify-self-end text-muted-foreground"
      />
    </Link>
  );
}
