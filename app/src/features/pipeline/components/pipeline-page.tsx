import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { IssueKind } from "@server/schemas";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils/cn";
import {
  ShellInlineFault,
  ShellLoadingState,
} from "@/app/shell-state";
import { KIND_LABEL } from "@/features/issues/lib/kind";
import {
  type IssueBackLocationState,
  issueBackNavigateState,
} from "@/features/issues/lib/issue-back";
import { issuePath } from "@/features/issues/lib/links";
import { PipelineDiagram } from "../pipeline-diagram";
import {
  parsePipelineId,
  parseStepId,
  pipelineById,
  writePipelineParam,
  writeStepParam,
} from "../pipeline-selection";
import { pipelines, type PipelineId } from "../shape";
import { usePipelineRunQuery } from "../api/queries";
import { useLiveRunSequence } from "../hooks/use-live-run-sequence";
import type { RunSequence } from "../run-sequence";
import { conditionCaption } from "./run-sequence-shared";
import { RunSequenceDiagram } from "./run-sequence-diagram";
import { PipelineRunsView } from "./pipeline-run-list";
import {
  PipelineStepSourcePanel,
  PipelineStepSourceSheet,
} from "./pipeline-step-source";

type PipelineView = "design" | "runs";

const PIPELINE_VIEWS: { id: PipelineView; label: string; to: string }[] = [
  { id: "design", label: "Design", to: "/pipeline" },
  { id: "runs", label: "Runs", to: "/pipeline/runs" },
];

function PipelineHeader() {
  return (
    <header>
      <p className="font-display text-[11px] font-semibold uppercase tracking-[0.22em] text-[hsl(var(--current))]">
        Pipeline
      </p>
    </header>
  );
}

function RunSequencePaneHeader({ sequence }: { sequence: RunSequence }) {
  const location = useLocation();
  const rootIssue = sequence.rootIssue;
  const rootIssueHref = rootIssue
    ? issuePath(rootIssue.projectId, rootIssue.id)
    : null;
  const linkState = issueBackNavigateState(
    location.pathname,
    location.search,
    (location.state as IssueBackLocationState | null)?.issueBackStack,
  );

  return (
    <div
      className="flex shrink-0 items-center justify-between gap-2 px-0.5 pb-1"
      data-testid="run-sequence-pane-header"
    >
      <h2 className="font-display text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        Sequence
      </h2>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
        <div
          className="flex min-h-[1.375rem] min-w-[10rem] items-center justify-end gap-1.5"
          data-testid="run-sequence-root-issue-slot"
        >
          {rootIssue && rootIssueHref ? (
            <>
              <p className="shrink-0 font-display text-[11px] font-semibold uppercase tracking-[0.22em] text-[hsl(var(--current))]">
                {KIND_LABEL[rootIssue.kind as IssueKind]}
              </p>
              <Link
                to={rootIssueHref}
                state={linkState}
                className="min-w-0 truncate text-sm font-medium text-[hsl(var(--current))] no-underline hover:underline"
                data-testid="run-sequence-root-issue-link"
              >
                {rootIssue.title}
              </Link>
            </>
          ) : null}
        </div>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
          {conditionCaption(sequence)}
        </span>
      </div>
    </div>
  );
}

function SelectedRunSequenceStatus({
  isLoading,
  error,
  isFetching,
  onReload,
}: {
  isLoading: boolean;
  error: Error | null;
  isFetching: boolean;
  onReload: () => void;
}) {
  if (isLoading) {
    return (
      <div className="min-w-0 flex-1">
        <ShellLoadingState label="Loading sequence…" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-w-0 flex-1">
        <ShellInlineFault
          message={error.message}
          hint="Check the server, then reload."
        />
        <Button
          variant="primary"
          size="sm"
          className="mt-3"
          disabled={isFetching}
          onClick={onReload}
        >
          Reload
        </Button>
      </div>
    );
  }

  return null;
}

function SelectedRunSequence({
  conversationId,
  layout,
}: {
  conversationId: string;
  layout: "desktop" | "phone";
}) {
  const navigate = useNavigate();
  const { data, isLoading, error, refetch, isFetching } =
    usePipelineRunQuery(conversationId);
  const sequence = useLiveRunSequence(conversationId, data);
  const status = (
    <SelectedRunSequenceStatus
      isLoading={isLoading}
      error={error}
      isFetching={isFetching}
      onReload={() => {
        void refetch();
      }}
    />
  );

  if (layout === "phone") {
    return (
      <Sheet
        open
        onOpenChange={(open) => {
          if (!open) navigate("/pipeline/runs", { replace: true });
        }}
      >
        <SheetContent
          side="top"
          dismissAffordance="bottom-handle"
          data-testid="pipeline-run-sequence-sheet"
          className="max-h-[85vh] overflow-hidden"
          aria-label="Run sequence"
        >
          <div className="-mx-6 -mt-6 flex min-h-0 flex-1 flex-col">
            <SheetTitle className="sr-only">Sequence</SheetTitle>
            {status}
            {sequence && !isLoading && !error ? (
              <>
                <SheetHeader className="shrink-0 space-y-0 border-b border-border bg-[hsl(var(--panel))] px-6 py-2.5 text-left">
                  <RunSequencePaneHeader sequence={sequence} />
                </SheetHeader>
                <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
                  <RunSequenceDiagram sequence={sequence} layout="phone" />
                </div>
              </>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  if (isLoading || error) return status;
  if (!sequence) return null;

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <RunSequencePaneHeader sequence={sequence} />
      <RunSequenceDiagram sequence={sequence} layout={layout} />
    </div>
  );
}

function PipelineViewSwitch({ activeView }: { activeView: PipelineView }) {
  return (
    <div
      role="tablist"
      aria-label="Pipeline view"
      className="flex flex-wrap items-center gap-0.5 rounded-md border border-border p-0.5"
    >
      {PIPELINE_VIEWS.map(({ id, label, to }) => {
        const selected = activeView === id;
        return (
          <Link
            key={id}
            to={to}
            role="tab"
            aria-selected={selected}
            id={`pipeline-view-tab-${id}`}
            aria-controls={`pipeline-view-panel-${id}`}
            tabIndex={selected ? 0 : -1}
            className={cn(
              "rounded-[calc(var(--radius)-2px)] px-3 py-1.5 text-xs font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected
                ? "bg-secondary text-secondary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </Link>
        );
      })}
    </div>
  );
}

function PipelineSwitcher({
  activeId,
  onSelect,
}: {
  activeId: PipelineId;
  onSelect: (id: PipelineId) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Pipeline"
      className="flex w-full max-w-md flex-wrap items-center gap-0.5 rounded-md border border-border p-0.5 shell:w-auto"
    >
      {pipelines.map((pipeline) => {
        const selected = activeId === pipeline.id;
        return (
          <button
            key={pipeline.id}
            type="button"
            role="tab"
            aria-selected={selected}
            id={`pipeline-tab-${pipeline.id}`}
            aria-controls="pipeline-diagram-panel"
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(pipeline.id)}
            className={cn(
              "flex-1 rounded-[calc(var(--radius)-2px)] px-3 py-1.5 text-xs font-medium transition-colors shell:flex-none",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected
                ? "bg-secondary text-secondary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {pipeline.title}
          </button>
        );
      })}
    </div>
  );
}

function PipelineDesignView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const isMobile = useIsMobile();
  const activeId = parsePipelineId(searchParams.get("pipeline"));
  const pipeline = pipelineById(activeId);
  const selectedStepId = parseStepId(searchParams.get("step"), pipeline);
  const selectedNode = pipeline.nodes.find((node) => node.id === selectedStepId);
  const selectedStep =
    selectedNode && selectedNode.kind !== "handoff" ? selectedNode : undefined;

  const selectPipeline = (id: PipelineId, replace: boolean) => {
    setSearchParams((prev) => {
      const next = writePipelineParam(prev, id);
      if (id !== activeId) next.delete("step");
      return next;
    }, { replace });
  };

  const selectStep = (stepId: string) => {
    setSearchParams(
      (prev) =>
        writeStepParam(prev, selectedStepId === stepId ? undefined : stepId),
      { replace: true },
    );
  };

  const dismissStep = () => {
    setSearchParams((prev) => writeStepParam(prev, undefined), {
      replace: true,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 shell:flex-row shell:items-end shell:justify-between">
        <h1 className="font-display text-xl font-semibold text-foreground">
          {pipeline.title}
        </h1>
        <PipelineSwitcher
          activeId={activeId}
          onSelect={(id) => selectPipeline(id, true)}
        />
      </div>
      <div
        role="tabpanel"
        id="pipeline-diagram-panel"
        aria-labelledby={`pipeline-tab-${activeId}`}
        className="flex flex-col gap-4 shell:flex-row shell:items-start"
      >
        <PipelineDiagram
          className="min-w-0 flex-1"
          pipeline={pipeline}
          selectedStepId={selectedStepId}
          onSelectStep={selectStep}
          onHandoff={(target) => selectPipeline(target, false)}
        />
        {selectedStep && !isMobile ? (
          <PipelineStepSourcePanel
            stepId={selectedStep.id}
            title={selectedStep.name}
            source={selectedStep.source}
            onDismiss={dismissStep}
          />
        ) : null}
        {selectedStep && isMobile ? (
          <PipelineStepSourceSheet
            stepId={selectedStep.id}
            title={selectedStep.name}
            source={selectedStep.source}
            onDismiss={dismissStep}
          />
        ) : null}
      </div>
    </div>
  );
}

/** Top-level Pipeline destination: design diagram and run history views. */
export function PipelinePage() {
  const { pathname } = useLocation();
  const { conversationId } = useParams<{ conversationId?: string }>();
  const activeView: PipelineView = pathname.startsWith("/pipeline/runs")
    ? "runs"
    : "design";

  return (
    <PageShell>
      <PipelineHeader />
      <PipelineViewSwitch activeView={activeView} />
      <div
        role="tabpanel"
        id={`pipeline-view-panel-${activeView}`}
        aria-labelledby={`pipeline-view-tab-${activeView}`}
      >
        {activeView === "design" ? (
          <PipelineDesignView />
        ) : (
          <PipelineRunsView
            conversationId={conversationId}
            renderSequence={(id, layout) => (
              <SelectedRunSequence conversationId={id} layout={layout} />
            )}
          />
        )}
      </div>
    </PageShell>
  );
}
