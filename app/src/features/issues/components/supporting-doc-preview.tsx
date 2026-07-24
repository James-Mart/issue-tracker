import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShellFaultDetail } from "@/app/shell-state";
import { requestText } from "@/lib/api/client";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils/cn";
import type { SupportingDocPreviewTab } from "../lib/supporting-docs";
import { supportingDocContentUrl } from "../lib/supporting-docs";
import { DetailEyebrow } from "./detail-section";
import { Markdown } from "./markdown";

const HTML_SANDBOX = "";

function PreviewSection({
  label,
  tone = "neutral",
  role,
  children,
}: {
  label: string;
  tone?: "neutral" | "blocked";
  role?: "status" | "alert";
  children: ReactNode;
}) {
  const isFault = tone === "blocked";
  return (
    <section
      className={cn(
        "rounded-lg border p-5",
        isFault
          ? "border-[hsl(var(--blocked)/0.45)] bg-[hsl(var(--blocked)/0.08)]"
          : "border-border bg-card",
      )}
      role={role ?? (isFault ? "alert" : undefined)}
      aria-live={role === "status" ? "polite" : undefined}
    >
      <DetailEyebrow className="mb-3">{label}</DetailEyebrow>
      {children}
    </section>
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
      <PreviewSection label={tab.label} role="status">
        <p className="mb-3 font-mono text-[11px] text-muted-foreground">
          Loading document…
        </p>
        <div className="space-y-3">
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-24 w-full" />
        </div>
      </PreviewSection>
    );
  }

  if (error) {
    return (
      <PreviewSection label={tab.label} tone="blocked">
        <div className="text-sm text-muted-foreground">
          <ShellFaultDetail
            message={
              error instanceof Error ? error.message : "Failed to load document."
            }
            hint="Check the pointer, then reopen this tab."
          />
        </div>
      </PreviewSection>
    );
  }

  const body = data ?? "";
  if (!body.trim()) {
    return (
      <PreviewSection label={tab.label}>
        <p className="text-sm text-muted-foreground">
          Document is empty. Edit the source file, then reopen this tab.
        </p>
      </PreviewSection>
    );
  }

  return (
    <PreviewSection label={tab.label}>
      <Markdown issueId={tab.ref.type === "attachment" ? projectId : undefined}>
        {body}
      </Markdown>
    </PreviewSection>
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
    <PreviewSection label={tab.label}>
      <iframe
        title={tab.label}
        src={src}
        sandbox={HTML_SANDBOX}
        className="h-[70vh] w-full rounded-md border border-border bg-[hsl(var(--void))]"
      />
    </PreviewSection>
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
