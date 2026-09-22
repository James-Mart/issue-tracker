import { offersExportChannel } from "@server/kind";
import type { Issue, IssueKind } from "@server/schemas";

/** Reserved draft basenames. Same shape as the server `EXPORT_DRAFT_NAME`. */
const EXPORT_DRAFT_NAME = /^github-export-.+\.md$/;

export function isExportDraftName(name: string): boolean {
  return EXPORT_DRAFT_NAME.test(name);
}

export function exportDraftCount(names: readonly string[]): number {
  let count = 0;
  for (const name of names) {
    if (isExportDraftName(name)) count += 1;
  }
  return count;
}

/**
 * Export is eligible on an unarchived Epic or project-level Story whose
 * Project workspace is set. Cockpit and Structure never mount the control.
 */
export function exportLaunchEligible(
  issue: Issue,
  parentKind: IssueKind | undefined,
  workspaceSet: boolean,
): boolean {
  return workspaceSet && offersExportChannel(issue, parentKind);
}

export function projectWorkspaceSet(
  issues: readonly { id: string; kind: string; workspace?: string }[],
  projectId: string,
): boolean {
  const project = issues.find((issue) => issue.id === projectId);
  if (!project || project.kind !== "project") return false;
  return Boolean(project.workspace?.trim());
}

/** One transcript event, narrowed to the fields that decide a failed rewrite. */
export type ExportTurnEvent = {
  type: string;
  status?: string;
};

/**
 * Latest turn of an idle export session failed: an error event, or a tool
 * call that ended in error and was not followed by a completed tool call.
 */
export function exportSessionFailed(
  events: readonly ExportTurnEvent[],
): boolean {
  let sawError = false;
  let lastToolStatus: string | undefined;
  for (const event of events) {
    if (event.type === "prompt") {
      sawError = false;
      lastToolStatus = undefined;
      continue;
    }
    if (event.type === "error") sawError = true;
    if (event.type === "tool_call" && event.status) {
      lastToolStatus = event.status;
    }
  }
  return sawError || lastToolStatus === "error";
}

export type ExportOverviewPhase =
  | "hidden"
  | "idle"
  | "running"
  | "failed"
  | "drafts-ready";

export function exportOverviewPhase(input: {
  eligible: boolean;
  liveRun: boolean;
  latestFailed: boolean;
  hasDrafts: boolean;
}): ExportOverviewPhase {
  if (!input.eligible) return "hidden";
  if (input.liveRun) return "running";
  if (input.hasDrafts) return "drafts-ready";
  if (input.latestFailed) return "failed";
  return "idle";
}

/** Export tab stays for a live rewrite, a failed first run, or any draft. */
export function exportTabVisible(input: {
  eligible: boolean;
  liveRun: boolean;
  latestFailed: boolean;
  hasDrafts: boolean;
}): boolean {
  const phase = exportOverviewPhase(input);
  return (
    phase === "running" || phase === "failed" || phase === "drafts-ready"
  );
}

/**
 * Keep `?tab=export` mounted while presence is still loading so the strip
 * effect does not bounce a deep link back to Overview.
 */
export function exportTabIncluded(
  exportTab: boolean | "loading",
  tabParam: string | null,
): boolean {
  return (
    exportTab === true || (exportTab === "loading" && tabParam === "export")
  );
}

/** Composer lock and Retry for the transcript-as-page (no drafts yet). */
export function exportTranscriptChrome(input: {
  activeRun: boolean;
  hasDrafts: boolean;
  latestFailed: boolean;
}): { composerDisabled: boolean; showRetry: boolean } {
  return {
    composerDisabled: input.activeRun && !input.hasDrafts,
    showRetry: !input.activeRun && input.latestFailed && !input.hasDrafts,
  };
}
