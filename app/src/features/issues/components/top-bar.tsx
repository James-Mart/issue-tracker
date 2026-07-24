import { useMemo } from "react";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { currentGlow, liveChip } from "@/components/ui/overlay-surfaces";
import { cn } from "@/lib/utils/cn";
import { useIssuesQuery } from "../api/queries";
import { useRouteProjectId } from "../hooks/use-route-project-id";
import { filterToProject } from "../lib/build-tree";
import { hasInFlightWork } from "../lib/derived";

export function TopBar() {
  const projectId = useRouteProjectId();
  const { data } = useIssuesQuery();

  const live = useMemo(() => {
    const all = data?.issues ?? [];
    // Cockpit (`/`) has no project scope — aggregate liveness across all work.
    const issues = projectId ? filterToProject(all, projectId) : all;
    return hasInFlightWork(issues, data?.derived ?? {});
  }, [data?.derived, data?.issues, projectId]);

  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-border px-4">
      <span
        className={liveChip}
        data-live={live ? "true" : "false"}
        aria-live="polite"
      >
        <span
          aria-hidden
          className={cn(
            "h-[7px] w-[7px] shrink-0 rounded-full",
            live
              ? cn(
                  "bg-[hsl(var(--current))] motion-safe:animate-live-dot",
                  currentGlow,
                )
              : "bg-[hsl(var(--rail-lit))]",
          )}
        />
        {live ? "agents on the line" : "all quiet"}
      </span>
      <ThemeToggle />
    </header>
  );
}
