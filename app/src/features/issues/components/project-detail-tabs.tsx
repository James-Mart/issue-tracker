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
    return <>{overview}</>;
  }

  const overviewSelected = resolvedActive === "overview";

  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label="Project detail"
        className="flex flex-wrap gap-1 border-b border-border"
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
        className={cn("flex flex-col gap-4", !overviewSelected && "hidden")}
        {...tabPanelVisibility(overviewSelected)}
      >
        {overview}
      </div>
      {previewTabs.map((tab) => {
        const selected = resolvedActive === tab.key;
        return (
          <div
            key={tab.key}
            role="tabpanel"
            className={cn(!selected && "hidden")}
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
