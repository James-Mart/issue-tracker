import type { ConversationChannel } from "@server/schemas";
import {
  ShellFaultDetail,
  ShellLoadingState,
  ShellState,
} from "@/app/shell-state";
import { ConversationThread } from "@/features/agents/components/conversation-thread";
import { currentChannelSession } from "../api/channel-sessions";
import { useChannelSessionsQuery } from "../api/queries";

/**
 * Full-width channel panel: Agents transcript for the channel's current
 * session, or an empty state naming what the channel is for.
 */
export function ChannelTranscriptPanel({
  issueId,
  channel,
  label,
}: {
  issueId: string;
  channel: ConversationChannel;
  label: string;
}) {
  const { data, isLoading, error } = useChannelSessionsQuery(issueId, channel);

  if (isLoading && !data) {
    return <ShellLoadingState label={`Loading ${label.toLowerCase()} channel…`} />;
  }

  if (error) {
    return (
      <ShellState
        tone="blocked"
        eyebrow="Fault"
        title={`Could not load the ${label.toLowerCase()} channel.`}
        detail={
          <ShellFaultDetail
            message={error.message}
            hint="Check the server, then reload."
          />
        }
      />
    );
  }

  const session = currentChannelSession(data ?? []);
  if (!session) {
    return (
      <ShellState
        className="border-0 bg-transparent px-4 py-8 shadow-none"
        eyebrow={label}
        title={`No ${label.toLowerCase()} session.`}
        detail={`This channel is for ${label.toLowerCase()} work on this issue.`}
      />
    );
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card"
      data-testid="channel-transcript-panel"
    >
      <ConversationThread
        key={session.id}
        conversationId={session.id}
        meta={{ title: session.title, model: session.model }}
      />
    </div>
  );
}
