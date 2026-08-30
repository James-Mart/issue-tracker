import { useMemo } from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { currentGlow, liveChip } from "@/components/ui/overlay-surfaces";
import { cn } from "@/lib/utils/cn";
import { useIssuesQuery } from "../api/queries";
import { useRouteProjectId } from "../hooks/use-route-project-id";
import { filterToProject } from "../lib/build-tree";
import { overlayCockpitLaunchAck } from "../lib/cockpit-launch-sync";
import { hasInFlightWork } from "../lib/derived";
import {
  useCockpitLaunchIssuesSync,
  useCockpitLaunchStore,
} from "../store/use-cockpit-launch-store";
import { RestartControl } from "./restart-control";

export function TopBar() {
  const projectId = useRouteProjectId();
  const { data } = useIssuesQuery();
  const pending = useCockpitLaunchStore((s) => s.pending);
  const ack = useCockpitLaunchStore((s) => s.ack);
  useCockpitLaunchIssuesSync(data?.derived);

  const live = useMemo(() => {
    const all = data?.issues ?? [];
    // Cockpit (`/`) has no project scope — aggregate liveness across all work.
    const issues = projectId ? filterToProject(all, projectId) : all;
    const derived = data?.derived ?? {};
    const derivedForLive = ack
      ? overlayCockpitLaunchAck(derived, issues, ack)
      : derived;
    return Boolean(pending) || hasInFlightWork(issues, derivedForLive);
  }, [ack, data?.derived, data?.issues, pending, projectId]);

  return (
    <header className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border px-3 shell:px-4">
      <div className="flex min-w-0 items-center gap-2">
        <SidebarTrigger />
        <span
          className={cn(liveChip, "min-w-0")}
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
          <span className="truncate">
            {live ? "agents on the line" : "all quiet"}
          </span>
        </span>
      </div>
      <div className="flex min-w-0 items-start justify-end gap-2">
        <RestartControl />
        <ThemeToggle />
      </div>
    </header>
  );
}
