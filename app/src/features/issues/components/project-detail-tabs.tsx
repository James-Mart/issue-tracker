import { useMemo, useState, type ReactNode } from "react";
import type { SupportingDocs } from "@server/schemas";
import { cn } from "@/lib/utils/cn";
import {
  previewableSupportingDocs,
  type SupportingDocPreviewTab,
} from "../lib/supporting-docs";
import { SupportingDocPreview } from "./supporting-doc-preview";

type TabId = "overview" | SupportingDocPreviewTab["key"];

export function ProjectDetailTabs({
  projectId,
  supportingDocs,
  overview,
}: {
  projectId: string;
  supportingDocs: SupportingDocs | undefined;
  overview: ReactNode;
}) {
  const previewTabs = useMemo(
    () => previewableSupportingDocs(supportingDocs),
    [supportingDocs],
  );
  const [active, setActive] = useState<TabId>("overview");
  const resolvedActive: TabId =
    active === "overview" || previewTabs.some((tab) => tab.key === active)
      ? active
      : "overview";

  if (previewTabs.length === 0) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">{overview}</div>
    );
  }

  const overviewSelected = resolvedActive === "overview";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div
        role="tablist"
        aria-label="Project detail"
        className="flex shrink-0 flex-wrap gap-1 border-b border-border shell:flex-nowrap"
      >
        <TabButton
          selected={overviewSelected}
          onClick={() => setActive("overview")}
        >
          Overview
        </TabButton>
        {previewTabs.map((tab) => (
          <TabButton
            key={tab.key}
            selected={resolvedActive === tab.key}
            onClick={() => setActive(tab.key)}
          >
            {tab.label}
          </TabButton>
        ))}
      </div>
      <div
        role="tabpanel"
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto",
          !overviewSelected && "hidden",
        )}
        {...tabPanelVisibility(overviewSelected)}
      >
        {overview}
      </div>
      {previewTabs.map((tab) => {
        const selected = resolvedActive === tab.key;
        const fillsReadingArea = tab.format === "html";
        return (
          <div
            key={tab.key}
            role="tabpanel"
            className={cn(
              "min-h-0 min-w-0 flex-1",
              fillsReadingArea
                ? "flex flex-col"
                : "overflow-y-auto",
              !selected && "hidden",
            )}
            {...tabPanelVisibility(selected)}
          >
            <SupportingDocPreview projectId={projectId} tab={tab} />
          </div>
        );
      })}
    </div>
  );
}

/** Keep panels mounted; freeze inactive ones. `inert` cast: React 18 DOM types omit it. */
function tabPanelVisibility(selected: boolean): Record<string, unknown> {
  return selected ? {} : { inert: "" };
}

function TabButton({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      className={cn(
        "-mb-px border-b-2 px-3 py-2 font-display text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors",
        selected
          ? "border-[hsl(var(--current))] text-[hsl(var(--current))]"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
