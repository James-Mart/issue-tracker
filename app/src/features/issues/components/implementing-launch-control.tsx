import { ListEnd, Loader2 } from "lucide-react";
import type { IssueKind, IssueRecord } from "@server/schemas";
import { ShellState } from "@/app/shell-state";
import { Button } from "@/components/ui/button";
import { useSendConversationMessage } from "@/features/agents/api/mutations";
import { useMemo } from "react";
import { ApiError } from "@/lib/api/errors";
import { useEnqueueWorkRoot } from "../api/mutations";
import { useChannelSessionsQuery } from "../api/queries";
import { useIssuesWithArchived } from "../hooks/use-issues-with-archived";
import { currentChannelSession } from "../api/channel-sessions";
import { useCockpitLaunchStore } from "../store/use-cockpit-launch-store";
import {
  implementingLaunchCopy,
  implementingResumePrompt,
  isImplementingWorkRoot,
  type ImplementingWorkRoot,
} from "@server/services/implementing-launch";
import { overviewWorkLoopAction } from "../lib/overview-work-loop-action";
import { issuesById } from "../lib/build-tree";
import { isWorkRootFinished, leafTasksOf } from "../lib/derived";
import { WorkLoopOverviewControl } from "./work-loop-overview-control";

type ImplementingWorkRootRecord = Extract<
  IssueRecord,
  { kind: "epic" | "story" }
>;

function enqueueFault(err: Error): { status?: number; errorMessage: string } {
  return {
    status: err instanceof ApiError ? err.status : undefined,
    errorMessage: err.message,
  };
}

function QueueWorkButton({
  issue,
  optimistic,
  testId,
}: {
  issue: ImplementingWorkRootRecord;
  optimistic?: boolean;
  testId: string;
}) {
  const failLaunch = useCockpitLaunchStore((s) => s.failLaunch);
  const beginLaunch = useCockpitLaunchStore((s) => s.beginLaunch);
  const ackLaunch = useCockpitLaunchStore((s) => s.ackLaunch);
  const abandonLaunch = useCockpitLaunchStore((s) => s.abandonLaunch);
  const pending = useCockpitLaunchStore((s) => s.pending);
  const enqueue = useEnqueueWorkRoot(issue.id, {
    onError: (err) => {
      if (!optimistic) return;
      failLaunch(issue.id, "work", enqueueFault(err));
    },
    onSuccess: (root) => {
      if (!optimistic) return;
      // A queued root did not start a session, so drop the optimistic starting state.
      if ("workQueuedAt" in root && root.workQueuedAt) {
        abandonLaunch(issue.id);
        return;
      }
      ackLaunch(issue.id, "work");
    },
  });
  const launching = Boolean(optimistic) && pending?.issueId === issue.id;
  const busy = enqueue.isPending || launching;

  const queue = () => {
    if (busy) return;
    if (optimistic) beginLaunch(issue.id, "work");
    enqueue.mutate();
  };

  return (
    <Button
      type="button"
      variant="default"
      size="icon-sm"
      title={busy ? "Queuing" : "Queue"}
      aria-label={busy ? "Queuing" : "Queue"}
      aria-busy={busy || undefined}
      data-testid={busy ? `${testId}-pending` : testId}
      disabled={busy}
      onClick={queue}
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" />
      ) : (
        <ListEnd className="h-3.5 w-3.5" />
      )}
    </Button>
  );
}

function useWorkRootLaunchFacts(issueId: string) {
  const { data: list } = useIssuesWithArchived(true);
  const { data: sessions, isLoading: sessionsLoading } = useChannelSessionsQuery(
    issueId,
    "implementing",
  );
  return useMemo(() => {
    const issues = list?.issues ?? [];
    const byId = issuesById(issues);
    const found = byId.get(issueId);
    const record =
      found?.kind === "epic" || found?.kind === "story" ? found : undefined;
    const derived = list?.derived ?? {};
    const currentSession = currentChannelSession(sessions ?? []);
    const finished = record
      ? isWorkRootFinished(record, issues, derived)
      : false;
    const holdsSlot =
      record !== undefined &&
      !record.archived &&
      !finished &&
      currentSession !== undefined;
    const queued = Boolean(record?.workQueuedAt);
    return {
      list,
      record,
      sessionsLoading,
      currentSession,
      finished,
      holdsSlot,
      queued,
      liveRun: derived[issueId]?.liveRun ?? false,
    };
  }, [issueId, list, sessions]);
}

/** Icon-only queue control for a Ready cockpit row. */
export function ImplementingFlowRowLaunch({
  issue,
}: {
  issue: ImplementingWorkRootRecord;
}) {
  return (
    <QueueWorkButton issue={issue} optimistic testId="flow-row-queue" />
  );
}

/** Post-rail Overview control: queue, or resume a slot-holding coordinator. */
export function ImplementingOverviewLaunch({
  issue,
  parentKind,
}: {
  issue: ImplementingWorkRoot;
  parentKind?: IssueKind;
}) {
  const facts = useWorkRootLaunchFacts(issue.id);
  const sendMessage = useSendConversationMessage();
  const failLaunch = useCockpitLaunchStore((s) => s.failLaunch);
  const beginLaunch = useCockpitLaunchStore((s) => s.beginLaunch);
  const ackLaunch = useCockpitLaunchStore((s) => s.ackLaunch);
  const pending = useCockpitLaunchStore((s) => s.pending);
  const launching = pending?.issueId === issue.id;

  const workLoopAction = useMemo(() => {
    if (!isImplementingWorkRoot("implementing", issue, parentKind)) {
      return { action: "hidden" as const };
    }
    if (!facts.record) return { action: "hidden" as const };
    const issues = facts.list?.issues ?? [];
    return overviewWorkLoopAction({
      liveRun: facts.liveRun,
      leafTasks: leafTasksOf(facts.record, issues),
      currentSession: facts.currentSession,
      queued: facts.queued || Boolean(issue.workQueuedAt),
      holdsSlot: facts.holdsSlot,
      finished: facts.finished,
      archived: Boolean(facts.record.archived),
    });
  }, [facts, issue, parentKind]);

  if (facts.sessionsLoading || workLoopAction.action === "hidden") {
    return null;
  }

  if (workLoopAction.action === "queue") {
    return (
      <QueueWorkButton
        issue={issue}
        optimistic
        testId="implementing-overview-queue"
      />
    );
  }

  const resumePending = sendMessage.isPending || launching;
  const resumeWorkLoop = () => {
    if (sendMessage.isPending || launching) return;
    const { resumeSession } = workLoopAction;
    beginLaunch(issue.id, "work", { resumeSession });
    sendMessage.mutate(
      {
        id: resumeSession.id,
        body: { prompt: implementingResumePrompt() },
      },
      {
        onSuccess: () => {
          ackLaunch(issue.id, "work", {
            id: resumeSession.id,
            title: resumeSession.title,
            model: resumeSession.model,
          });
        },
        onError: (err) => {
          failLaunch(issue.id, "work", enqueueFault(err));
        },
      },
    );
  };

  return (
    <WorkLoopOverviewControl
      session={workLoopAction.resumeSession}
      actionTestId="implementing-overview-resume-session"
      disabled={resumePending}
      pending={resumePending}
      onAction={resumeWorkLoop}
    />
  );
}

function queueControlHidden(
  facts: {
    sessionsLoading: boolean;
    finished: boolean;
    queued: boolean;
    holdsSlot: boolean;
  },
  issue: { workQueuedAt?: string; archived?: boolean },
): boolean {
  return (
    facts.sessionsLoading ||
    facts.finished ||
    facts.queued ||
    Boolean(issue.workQueuedAt) ||
    facts.holdsSlot ||
    Boolean(issue.archived)
  );
}

/** Empty-state queue control for an Epic or project-level Story. */
export function ImplementingChannelEmptyState({
  issue,
}: {
  issue: ImplementingWorkRoot;
}) {
  const facts = useWorkRootLaunchFacts(issue.id);
  const copy = implementingLaunchCopy();
  const queued = facts.queued || Boolean(issue.workQueuedAt);
  const canQueue = !queueControlHidden(facts, issue);

  return (
    <ShellState
      className="border-0 bg-transparent px-4 py-8 shadow-none"
      eyebrow="Implementing"
      title={queued ? "Waiting in the queue." : copy.title}
      detail={
        queued
          ? "It starts when it is next and a slot is free."
          : copy.detail
      }
      action={
        canQueue ? (
          <QueueWorkButton
            issue={issue}
            optimistic
            testId="implementing-queue"
          />
        ) : undefined
      }
    />
  );
}

/**
 * Header queue control once sessions exist but the root is not in the queue
 * and does not hold a slot. A slot-holder is messaged on its coordinator.
 */
export function ImplementingNewRunControl({
  issue,
}: {
  issue: ImplementingWorkRoot;
}) {
  const facts = useWorkRootLaunchFacts(issue.id);
  if (queueControlHidden(facts, issue)) return null;
  return (
    <QueueWorkButton issue={issue} optimistic testId="implementing-queue" />
  );
}
