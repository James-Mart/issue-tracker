import { useEffect, useRef, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import type { IssueDetail } from "@server/schemas";
import { ShellInlineFault } from "@/app/shell-state";
import { useConversationTranscriptQuery } from "@/features/agents/api/queries";
import { Button } from "@/components/ui/button";
import { currentChannelSession } from "../api/channel-sessions";
import { useAttachmentsQuery, useChannelSessionsQuery } from "../api/queries";
import { useStartExportSession } from "../hooks/use-export-session";
import {
  exportDraftCount,
  exportOverviewPhase,
  exportSessionFailed,
  exportTabVisible,
  type ExportOverviewPhase,
} from "../lib/export-tab";
import { writeIssueDetailTabParam } from "../lib/issue-detail-tabs";
import { SettingsCard } from "./detail-section";

function useExportSurface(issueId: string) {
  const sessions = useChannelSessionsQuery(issueId, "export");
  const attachments = useAttachmentsQuery(issueId);
  const current = currentChannelSession(sessions.data ?? []);
  const needsOutcome = Boolean(current && !current.activeRun);
  const transcript = useConversationTranscriptQuery(
    needsOutcome ? current?.id : undefined,
  );
  const draftCount = exportDraftCount(
    (attachments.data ?? []).map((item) => item.name),
  );
  const hasDrafts = draftCount > 0;
  const liveRun = current?.activeRun ?? false;
  const outcomePending =
    needsOutcome && !transcript.isFetched && !transcript.isError;
  const fault = sessions.isError
    ? (sessions.error?.message ?? "Could not load export sessions.")
    : attachments.isError
      ? (attachments.error?.message ?? "Could not load attachments.")
      : null;
  const ready =
    !fault &&
    !sessions.isLoading &&
    sessions.data !== undefined &&
    !attachments.isLoading &&
    attachments.data !== undefined &&
    !outcomePending;
  const latestFailed =
    needsOutcome &&
    (transcript.isError ||
      exportSessionFailed(transcript.data?.events ?? []));
  const phase: ExportOverviewPhase | "loading" | "fault" = fault
    ? "fault"
    : ready
      ? exportOverviewPhase({
          eligible: true,
          liveRun,
          latestFailed,
          hasDrafts,
        })
      : "loading";
  const showTab =
    ready &&
    exportTabVisible({
      eligible: true,
      liveRun,
      latestFailed,
      hasDrafts,
    });
  return { phase, showTab, draftCount, ready, fault };
}

function phaseDetail(
  phase: Exclude<ExportOverviewPhase, "hidden">,
  kind: IssueDetail["kind"],
  draftCount: number,
): ReactNode {
  if (phase === "running") {
    return (
      <>
        <span className="text-[hsl(var(--current))]">Export in progress</span>
        {" — open Export for transcript."}
      </>
    );
  }
  if (phase === "failed") {
    return (
      <>
        <span className="text-destructive">Export failed</span>
        {" — drafts rolled back. Open Export for transcript and retry."}
      </>
    );
  }
  if (phase === "drafts-ready") {
    const noun = draftCount === 1 ? "draft" : "drafts";
    return `${draftCount} ${noun} attached — open Export to review.`;
  }
  const root = kind === "story" ? "story" : "epic";
  return `Propose GitHub issues from this ${root} — opens Export.`;
}

/** Overview card: start posts one export session; later clicks only open the tab. */
export function ExportOverviewLaunch({
  issue,
  onTabVisible,
}: {
  issue: IssueDetail;
  onTabVisible: (visible: boolean) => void;
}) {
  const surface = useExportSurface(issue.id);
  const [, setSearchParams] = useSearchParams();
  const { start, pending, modelReady } = useStartExportSession(issue);
  const holdVisible = useRef(false);

  const openExport = () => {
    setSearchParams((prev) => writeIssueDetailTabParam(prev, "export"), {
      replace: true,
    });
  };

  useEffect(() => {
    if (surface.phase === "loading") return;
    if (holdVisible.current) {
      if (!surface.showTab) return;
      holdVisible.current = false;
    }
    onTabVisible(surface.showTab);
  }, [onTabVisible, surface.phase, surface.showTab]);

  if (surface.phase === "loading") return null;

  if (surface.phase === "fault") {
    return (
      <SettingsCard title="GitHub export" data-testid="export-overview-launch">
        <ShellInlineFault
          message={surface.fault ?? "Could not load export."}
          hint="Check the server, then reload."
        />
      </SettingsCard>
    );
  }

  const idle = surface.phase === "idle";
  const detail = phaseDetail(surface.phase, issue.kind, surface.draftCount);

  return (
    <SettingsCard
      title="GitHub export"
      data-testid="export-overview-launch"
      data-phase={surface.phase}
      action={
        idle ? (
          <Button
            type="button"
            variant="default"
            size="sm"
            className="shrink-0"
            disabled={!modelReady || pending}
            data-testid="export-overview-start"
            onClick={() => {
              if (!modelReady || pending) return;
              holdVisible.current = true;
              onTabVisible(true);
              start({
                onSuccess: () => openExport(),
                onError: () => {
                  holdVisible.current = false;
                  onTabVisible(false);
                },
              });
            }}
          >
            {pending ? "Starting…" : "Export to GitHub"}
          </Button>
        ) : (
          <Button
            type="button"
            variant="default"
            size="sm"
            className="shrink-0"
            data-testid="export-overview-open"
            onClick={openExport}
          >
            {surface.phase === "running" ? (
              <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" />
            ) : null}
            Open Export
          </Button>
        )
      }
    >
      <p className="text-sm text-muted-foreground">{detail}</p>
    </SettingsCard>
  );
}
