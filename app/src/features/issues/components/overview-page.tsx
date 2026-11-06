import { useMemo } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { PageShell } from "@/components/page-shell";
import { tabTitleEntityName, useTabTitle } from "@/lib/tab-title/use-tab-title";
import { Button } from "@/components/ui/button";
import {
  IssuesQueryShell,
  ShellFaultDetail,
  ShellInlineFault,
  ShellLoadingState,
  ShellState,
} from "@/app/shell-state";
import { useUploadAttachment } from "../api/mutations";
import { useIssueDetailQuery, useIssuesQuery } from "../api/queries";
import { overviewLensTabSuffix, parseOverviewLens } from "../lib/overview-lens";
import { ProjectStructureSection } from "./project-structure-lens";
import { ProjectLensSwitcher } from "./project-lens-switcher";
import { ProjectSettingsOverview } from "./project-settings-overview";

function OverviewHeader({ title }: { title: string }) {
  return (
    <header>
      <p className="font-display text-[11px] font-semibold uppercase tracking-[0.22em] text-[hsl(var(--current))]">
        Overview
      </p>
      <h1 className="truncate text-base font-semibold tracking-tight text-foreground">
        {title}
      </h1>
    </header>
  );
}

/** Project-scoped Overview lens: the Project issue's own detail content. */
function OverviewProjectLens({ projectId }: { projectId: string }) {
  const { data: issue, isLoading, error } = useIssueDetailQuery(projectId);
  const upload = useUploadAttachment(projectId);

  return (
    <div className="flex flex-col gap-6">
      {isLoading && !issue ? (
        <ShellLoadingState label="Loading project…" />
      ) : null}

      {error ? (
        <ShellInlineFault
          message={error.message}
          hint="Check the server, then reload."
        />
      ) : null}

      {issue?.kind === "project" ? (
        <ProjectSettingsOverview issue={issue} upload={upload} />
      ) : null}
    </div>
  );
}

/** Per-project overview shell: shared toolbar + Structure / Overview lenses (`?lens=`). */
export function OverviewPage() {
  const { projectId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const lens = parseOverviewLens(searchParams.get("lens"));
  const { data, isLoading, error, refetch, isFetching } = useIssuesQuery();

  const issues = data?.issues ?? [];
  const project = useMemo(
    () =>
      issues.find(
        (issue) => issue.id === projectId && issue.kind === "project",
      ),
    [issues, projectId],
  );
  const catalog = project?.kind === "project" ? (project.labels ?? []) : [];
  useTabTitle(
    tabTitleEntityName(project?.title, projectId),
    overviewLensTabSuffix(lens),
  );

  return (
    <IssuesQueryShell
      isLoading={isLoading}
      error={error}
      isFetching={isFetching}
      onReload={() => void refetch()}
      loadingLabel="Loading overview…"
      errorTitle="Couldn't load the overview."
    >
      {!project ? (
        <PageShell>
          <OverviewHeader title="Project not found" />
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
        <PageShell>
          <OverviewHeader title={project.title} />
          <ProjectLensSwitcher projectId={projectId} active={lens} />
          {lens === "structure" ? (
            <ProjectStructureSection projectId={projectId} catalog={catalog} />
          ) : null}

          {lens === "overview" ? (
            <OverviewProjectLens projectId={projectId} />
          ) : null}
        </PageShell>
      )}
    </IssuesQueryShell>
  );
}
