import { useMemo } from "react";
import { ChevronRight } from "lucide-react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import type { IssueDetail } from "@server/schemas";
import { ShellInlineFault, ShellState } from "@/app/shell-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { useReconcileRoot } from "../api/mutations";
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
import { writeIssueDetailTabParam } from "../lib/issue-detail-tabs";
import { linkedRootVersionLabel } from "../lib/project-outlines";
import { useIssueUiStore } from "../store/use-issue-ui-store";
import { AxisChips, BEHIND_AXIS_CHIP } from "./axis-chips";
import { DetailEyebrow, SETTINGS_HEADING_CLASS } from "./detail-section";
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
  const placementLive = query.data?.derived[issue.id]?.placementLive === true;
  const reconcile = useReconcileRoot(issue.id);
  const [, setSearchParams] = useSearchParams();
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
      <div className="shell:grid shell:grid-cols-[5.5rem_minmax(0,1fr)_auto_auto] shell:gap-x-4">
        <div
          className="mb-1 hidden border-b border-border pb-1 shell:col-span-4 shell:grid shell:grid-cols-subgrid shell:items-center"
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
        <ul className="flex list-none flex-col p-0 shell:col-span-4 shell:grid shell:grid-cols-subgrid">
          {roots.map((root) => (
            <li
              key={root.id}
              className="border-b border-border last:border-b-0 shell:col-span-4 shell:grid shell:grid-cols-subgrid shell:items-center"
            >
              <LinkedRootRow
                root={root}
                latest={issue.bodyVersion}
                projectId={issue.partOf}
                linkState={linkState}
                showReconcile={root.open && root.behind && !placementLive}
                reconcilePending={
                  reconcile.isPending && reconcile.variables === root.id
                }
                onReconcile={() => {
                  reconcile.mutate(root.id, {
                    onSuccess: () => {
                      setSearchParams(
                        (prev) => writeIssueDetailTabParam(prev, "decomposition"),
                        { replace: true },
                      );
                    },
                  });
                }}
              />
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <section
      className="rounded-lg border border-border bg-card p-5"
      data-testid="outline-linked-work"
    >
      <div className="mb-3 flex min-h-8 items-center gap-2">
        <DetailEyebrow>Linked work</DetailEyebrow>
      </div>
      {body}
    </section>
  );
}

function LinkedRootRow({
  root,
  latest,
  projectId,
  linkState,
  showReconcile,
  reconcilePending,
  onReconcile,
}: {
  root: LinkedRoot;
  latest: number;
  projectId: string;
  linkState: ReturnType<typeof issueBackNavigateState>;
  showReconcile: boolean;
  reconcilePending: boolean;
  onReconcile: () => void;
}) {
  const version = linkedRootVersionLabel(root.version, latest);
  return (
    <div
      data-testid={`outline-linked-root-${root.id}`}
      className="flex flex-col gap-2 shell:contents"
    >
      <Link
        to={issuePath(projectId, root.id)}
        state={linkState}
        className={cn(
          "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 rounded-md border border-transparent py-2.5 text-foreground hover:border-[hsl(var(--rail-lit))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          showReconcile
            ? "shell:col-span-3 shell:grid shell:grid-cols-subgrid shell:gap-x-4"
            : "shell:col-span-4 shell:grid shell:grid-cols-subgrid shell:gap-x-4",
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
          <span className="mt-0.5 block whitespace-nowrap font-mono text-xs tabular-nums text-muted-foreground shell:hidden">
            {version}
          </span>
        </span>
        <span
          data-testid={`outline-linked-root-version-${root.id}`}
          className="hidden whitespace-nowrap text-right font-mono text-xs tabular-nums text-muted-foreground shell:block"
        >
          {version}
        </span>
        <span
          className={cn(
            "flex items-center justify-end gap-2",
            showReconcile && "shell:hidden",
          )}
        >
          {root.behind && !showReconcile ? (
            <AxisChips chips={[BEHIND_AXIS_CHIP]} />
          ) : null}
          <ChevronRight
            aria-hidden="true"
            className="h-4 w-4 text-muted-foreground shell:hidden"
          />
        </span>
      </Link>
      {showReconcile ? (
        <span className="flex items-center justify-end gap-2 pb-2.5 shell:col-start-4 shell:pb-0">
          {root.behind ? <AxisChips chips={[BEHIND_AXIS_CHIP]} /> : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid={`outline-root-reconcile-${root.id}`}
            disabled={reconcilePending}
            onClick={onReconcile}
          >
            Reconcile only
          </Button>
        </span>
      ) : null}
    </div>
  );
}
