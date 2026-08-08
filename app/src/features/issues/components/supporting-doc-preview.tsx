import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShellFaultDetail } from "@/app/shell-state";
import { READING_MEASURE_CLASS } from "@/components/page-shell";
import { requestText } from "@/lib/api/client";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils/cn";
import type { SupportingDocPreviewTab } from "../lib/supporting-docs";
import { supportingDocContentUrl } from "../lib/supporting-docs";
import { DetailEyebrow } from "./detail-section";
import { Markdown } from "./markdown";

/** Restrictive sandbox: no scripts, forms, or same-origin access. */
const HTML_SANDBOX = "";

function StatusSurface({
  tone = "neutral",
  role,
  children,
}: {
  tone?: "neutral" | "blocked";
  role?: "status" | "alert";
  children: ReactNode;
}) {
  const isFault = tone === "blocked";
  return (
    <div
      className={cn(
        "min-w-0 rounded-lg border p-5",
        READING_MEASURE_CLASS,
        isFault
          ? "border-[hsl(var(--blocked)/0.45)] bg-[hsl(var(--blocked)/0.08)]"
          : "border-border bg-card",
      )}
      role={role ?? (isFault ? "alert" : undefined)}
      aria-live={role === "status" ? "polite" : undefined}
    >
      {children}
    </div>
  );
}

function SupportingDocMarkdown({
  projectId,
  tab,
}: {
  projectId: string;
  tab: SupportingDocPreviewTab;
}) {
  const url = supportingDocContentUrl(projectId, tab.ref);
  const { data, isLoading, error } = useQuery({
    queryKey: ["supporting-doc-content", projectId, tab.key, url],
    queryFn: () => requestText(url),
  });

  if (isLoading) {
    return (
      <StatusSurface role="status">
        <DetailEyebrow className="mb-3">{tab.label}</DetailEyebrow>
        <p className="mb-3 font-mono text-[11px] text-muted-foreground">
          Loading document…
        </p>
        <div className="space-y-3">
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-24 w-full" />
        </div>
      </StatusSurface>
    );
  }

  if (error) {
    return (
      <StatusSurface tone="blocked">
        <DetailEyebrow className="mb-3">{tab.label}</DetailEyebrow>
        <div className="text-sm text-muted-foreground">
          <ShellFaultDetail
            message={
              error instanceof Error ? error.message : "Failed to load document."
            }
            hint="Check the pointer, then reopen this tab."
          />
        </div>
      </StatusSurface>
    );
  }

  const body = data ?? "";
  if (!body.trim()) {
    return (
      <StatusSurface>
        <DetailEyebrow className="mb-3">{tab.label}</DetailEyebrow>
        <p className="text-sm text-muted-foreground">
          Document is empty. Edit the source file, then reopen this tab.
        </p>
      </StatusSurface>
    );
  }

  return (
    <article className="min-w-0">
      <Markdown issueId={tab.ref.type === "attachment" ? projectId : undefined}>
        {body}
      </Markdown>
    </article>
  );
}

function SupportingDocHtmlFrame({
  projectId,
  tab,
}: {
  projectId: string;
  tab: SupportingDocPreviewTab;
}) {
  const src = supportingDocContentUrl(projectId, tab.ref);
  return (
    <div className="relative min-h-0 w-full flex-1">
      <iframe
        title={tab.label}
        src={src}
        sandbox={HTML_SANDBOX}
        className="absolute inset-0 h-full w-full rounded-lg border border-border bg-[hsl(var(--void))]"
      />
    </div>
  );
}

export function SupportingDocPreview({
  projectId,
  tab,
}: {
  projectId: string;
  tab: SupportingDocPreviewTab;
}) {
  if (tab.format === "md") {
    return <SupportingDocMarkdown projectId={projectId} tab={tab} />;
  }
  return <SupportingDocHtmlFrame projectId={projectId} tab={tab} />;
}
