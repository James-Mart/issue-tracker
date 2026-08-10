import type {
  ChannelSessionListItem,
  ConversationChannel,
  IssueDetail,
  IssueKind,
} from "@server/schemas";
import { Button } from "@/components/ui/button";
import { useSendConversationMessage } from "@/features/agents/api/mutations";
import { usePlanningWorkRootQuery } from "../api/queries";
import {
  implementingRetroWorkRoot,
  retroSessionMessage,
} from "../lib/retro-launch";

function useRetroWorkRoot(
  channel: ConversationChannel,
  issue: IssueDetail,
  parentKind?: IssueKind,
) {
  const planningIdea = channel === "planning" && issue.kind === "idea";
  const planningQuery = usePlanningWorkRootQuery(
    planningIdea ? issue.id : undefined,
  );
  const implementingRoot = implementingRetroWorkRoot(
    channel,
    issue,
    parentKind,
  );

  if (channel === "implementing") {
    return {
      workRoot: implementingRoot,
      planNotLanded: false,
      fetchError: false,
      loading: false,
    };
  }

  if (!planningIdea) {
    return {
      workRoot: undefined,
      planNotLanded: false,
      fetchError: false,
      loading: false,
    };
  }

  const workRoot = planningQuery.data?.workRoot ?? undefined;
  return {
    workRoot: workRoot
      ? { id: workRoot.id, title: workRoot.title }
      : undefined,
    planNotLanded:
      planningQuery.isSuccess && planningQuery.data?.workRoot == null,
    fetchError: planningQuery.isError,
    loading: planningQuery.isLoading,
  };
}

/** Secondary header action to kick off retro on a finished channel session. */
export function ChannelRetroControl({
  channel,
  session,
  issue,
  parentKind,
}: {
  channel: ConversationChannel;
  session: ChannelSessionListItem;
  issue: IssueDetail;
  parentKind?: IssueKind;
}) {
  const sendMessage = useSendConversationMessage();
  const { workRoot, planNotLanded, fetchError, loading } = useRetroWorkRoot(
    channel,
    issue,
    parentKind,
  );

  if (session.activeRun) return null;

  const disabled =
    loading ||
    fetchError ||
    planNotLanded ||
    workRoot == null ||
    sendMessage.isPending;

  const startRetro = () => {
    if (!workRoot || disabled) return;
    sendMessage.mutate({
      id: session.id,
      body: { prompt: retroSessionMessage(workRoot.id, workRoot.title) },
    });
  };

  return (
    <div className="flex min-w-0 items-center gap-2">
      {planNotLanded ? (
        <span
          className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground"
          data-testid="retro-plan-not-landed"
        >
          Plan has not landed
        </span>
      ) : fetchError ? (
        <span
          className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground"
          data-testid="retro-work-root-fault"
        >
          Could not resolve work root
        </span>
      ) : null}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={disabled}
        data-testid="channel-retro"
        title={planNotLanded ? "The plan has not landed yet." : undefined}
        onClick={startRetro}
      >
        {sendMessage.isPending ? "Starting…" : "Retro"}
      </Button>
    </div>
  );
}
