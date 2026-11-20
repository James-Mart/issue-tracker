import { Link } from "react-router-dom";
import { issueDetailChannelLabel } from "../lib/issue-detail-tabs";
import { issueChannelPath } from "../lib/links";

/**
 * The one busy reason on an idle outline channel: the other channel's run
 * is live. The run name opens that channel's tab.
 */
export function OutlineChannelBusyNote({
  projectId,
  issueId,
  channel,
  runTitle,
}: {
  projectId: string;
  issueId: string;
  channel: "planning" | "decomposition";
  runTitle: string;
}) {
  return (
    <p
      data-testid="outline-channel-busy"
      className="shrink-0 border-t border-border px-4 py-2 text-sm text-muted-foreground"
    >
      Composer paused while {issueDetailChannelLabel(channel)} run{" "}
      <Link
        to={issueChannelPath(projectId, issueId, channel)}
        className="text-primary hover:underline"
      >
        {runTitle}
      </Link>{" "}
      is live on this outline.
    </p>
  );
}
