import type { ReactNode } from "react";
import { X } from "lucide-react";
import { ShellFaultDetail } from "@/app/shell-state";
import { TranscriptMarkdownText } from "@/features/agents/components/transcript-ui";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils/cn";
import { usePipelineStepSourceQuery } from "../api/queries";

function StepSourceStatus({
  title,
  source,
  children,
  omitHeader = false,
}: {
  title: string;
  source: string;
  children: ReactNode;
  omitHeader?: boolean;
}) {
  return (
    <div className="min-w-0 space-y-3">
      {omitHeader ? null : (
        <header className="min-w-0 space-y-1.5 pr-8">
          <h2 className="text-base font-semibold tracking-tight text-foreground">
            {title}
          </h2>
          <p className="break-all font-mono text-[11px] text-muted-foreground">
            {source}
          </p>
        </header>
      )}
      {children}
    </div>
  );
}

export function PipelineStepSourceBody({
  stepId,
  title,
  source,
  omitHeader = false,
}: {
  stepId: string;
  title: string;
  source: string;
  omitHeader?: boolean;
}) {
  const { data, isLoading, error, refetch, isFetching } =
    usePipelineStepSourceQuery(stepId);

  if (isLoading) {
    return (
      <StepSourceStatus title={title} source={source} omitHeader={omitHeader}>
        <div role="status" aria-live="polite">
          <p className="mb-3 font-mono text-[11px] text-muted-foreground">
            Loading step source…
          </p>
          <div className="space-y-3">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-24 w-full" />
          </div>
        </div>
      </StepSourceStatus>
    );
  }

  if (error) {
    return (
      <StepSourceStatus title={title} source={source} omitHeader={omitHeader}>
        <div
          className="rounded-md border border-[hsl(var(--blocked)/0.45)] bg-[hsl(var(--blocked)/0.08)] px-3 py-2.5 text-sm text-muted-foreground"
          role="alert"
        >
          <ShellFaultDetail
            message={error.message}
            hint="Check the server, then try again."
          />
          <Button
            type="button"
            variant="default"
            size="sm"
            className="mt-3"
            disabled={isFetching}
            onClick={() => {
              void refetch();
            }}
          >
            Try again
          </Button>
        </div>
      </StepSourceStatus>
    );
  }

  return (
    <StepSourceStatus
      title={title}
      source={data!.source}
      omitHeader={omitHeader}
    >
      <TranscriptMarkdownText text={data!.markdown} />
    </StepSourceStatus>
  );
}

const sourceSurfaceClass =
  "min-w-0 overflow-y-auto rounded-md border border-border bg-[hsl(var(--panel))] p-4";

export function PipelineStepSourcePanel({
  stepId,
  title,
  source,
  onDismiss,
}: {
  stepId: string;
  title: string;
  source: string;
  onDismiss: () => void;
}) {
  return (
    <aside
      id="pipeline-step-source"
      data-testid="pipeline-step-source-panel"
      aria-label={`${title} source`}
      className={cn(
        sourceSurfaceClass,
        "relative hidden max-h-[min(80vh,48rem)] w-full shell:block shell:w-[min(100%,28rem)]",
      )}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="absolute right-2 top-2"
        aria-label="Close"
        onClick={onDismiss}
      >
        <X />
      </Button>
      <PipelineStepSourceBody stepId={stepId} title={title} source={source} />
    </aside>
  );
}

function PipelineStepSourceSheetHeader({
  title,
  source,
}: {
  title: string;
  source: string;
}) {
  return (
    <SheetHeader
      className="shrink-0 space-y-0.5 border-b border-border bg-[hsl(var(--panel))] px-6 py-2.5 text-left"
      data-testid="pipeline-step-source-header"
    >
      <p className="font-display text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        Source
      </p>
      <SheetTitle className="text-base font-semibold tracking-tight">
        {title}
      </SheetTitle>
      <SheetDescription className="break-all font-mono text-[11px]">
        {source}
      </SheetDescription>
    </SheetHeader>
  );
}

export function PipelineStepSourceSheet({
  stepId,
  title,
  source,
  onDismiss,
}: {
  stepId: string;
  title: string;
  source: string;
  onDismiss: () => void;
}) {
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
    >
      <SheetContent
        side="top"
        dismissAffordance="bottom-handle"
        id="pipeline-step-source"
        data-testid="pipeline-step-source-sheet"
        className="max-h-[85vh] overflow-hidden"
        aria-label={`${title} source`}
      >
        <div className="-mx-6 -mt-6 flex min-h-0 flex-1 flex-col">
          <PipelineStepSourceSheetHeader title={title} source={source} />
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            <PipelineStepSourceBody
              stepId={stepId}
              title={title}
              source={source}
              omitHeader
            />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
