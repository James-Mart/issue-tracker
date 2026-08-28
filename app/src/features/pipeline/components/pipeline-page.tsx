import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import { PageShell } from "@/components/page-shell";
import { ShellState } from "@/app/shell-state";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils/cn";
import { PipelineDiagram } from "../pipeline-diagram";
import {
  parsePipelineId,
  parseStepId,
  pipelineById,
  writePipelineParam,
  writeStepParam,
} from "../pipeline-selection";
import { pipelines, type PipelineId } from "../shape";
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

function PipelineRunsPlaceholder({
  conversationId,
}: {
  conversationId?: string;
}) {
  return (
    <ShellState
      eyebrow="Runs"
      title="Pipeline runs placeholder"
      detail={
        conversationId ? (
          <>
            run-list-and-selection replaces this placeholder. Selected run:{" "}
            <span className="font-mono text-xs">{conversationId}</span>
          </>
        ) : (
          "run-list-and-selection replaces this placeholder."
        )
      }
    />
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
          <PipelineRunsPlaceholder conversationId={conversationId} />
        )}
      </div>
    </PageShell>
  );
}
