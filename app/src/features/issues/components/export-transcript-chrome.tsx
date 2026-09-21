import type { ReactNode } from "react";
import { RotateCw } from "lucide-react";
import type { ChannelSessionListItem } from "@server/schemas";
import { useConversationTranscriptQuery } from "@/features/agents/api/queries";
import { Button } from "@/components/ui/button";
import { useAttachmentsQuery } from "../api/queries";
import { useStartExportSession } from "../hooks/use-export-session";
import {
  exportDraftCount,
  exportSessionFailed,
  exportTranscriptChrome,
} from "../lib/export-tab";

export const EXPORT_REWRITE_COMPOSER_PLACEHOLDER =
  "Message disabled while rewrite runs...";

/** Transcript-page chrome while no drafts exist: lock the composer, or Retry. */
export function useExportTranscriptChrome(
  issue: { id: string; title: string },
  session: ChannelSessionListItem | undefined,
  onRetried: (session: { id: string }) => void,
): {
  composerDisabled: boolean;
  composerDisabledPlaceholder?: string;
  retry: ReactNode;
} {
  const attachments = useAttachmentsQuery(issue.id);
  const needsOutcome = Boolean(session && !session.activeRun);
  const transcript = useConversationTranscriptQuery(
    needsOutcome ? session?.id : undefined,
  );
  const hasDrafts =
    exportDraftCount((attachments.data ?? []).map((item) => item.name)) > 0;
  const latestFailed =
    needsOutcome &&
    (transcript.isError ||
      (transcript.isFetched &&
        exportSessionFailed(transcript.data?.events ?? [])));
  const chrome = exportTranscriptChrome({
    activeRun: session?.activeRun ?? false,
    hasDrafts,
    latestFailed,
  });
  const { start, pending, modelReady } = useStartExportSession(issue);
  const retry = chrome.showRetry ? (
    <Button
      type="button"
      variant="default"
      size="sm"
      className="shrink-0"
      disabled={!modelReady || pending}
      data-testid="export-retry"
      onClick={() => start({ onSuccess: onRetried })}
    >
      <RotateCw />
      {pending ? "Starting…" : "Retry export"}
    </Button>
  ) : null;
  return {
    composerDisabled: chrome.composerDisabled,
    composerDisabledPlaceholder: chrome.composerDisabled
      ? EXPORT_REWRITE_COMPOSER_PLACEHOLDER
      : undefined,
    retry,
  };
}
