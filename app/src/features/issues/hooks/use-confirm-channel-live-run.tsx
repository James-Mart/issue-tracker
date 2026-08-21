import { useState, type ReactNode } from "react";
import type {
  ChannelSessionListItem,
  ConversationChannel,
} from "@server/schemas";
import { useQueryClient } from "@tanstack/react-query";
import { agentsKeys } from "@/features/agents/api/keys";
import { currentChannelSession } from "../api/channel-sessions";
import { issuesKeys } from "../api/keys";
import { useChannelSessionsQuery } from "../api/queries";
import { ChannelKillLiveRunDialog } from "../components/channel-kill-live-run-dialog";
import {
  markChannelSessionRetired,
  retireChannelLiveSession,
} from "../lib/retire-channel-live-session";

type PendingAction = () => void | Promise<void>;

/**
 * Gate a channel action behind confirmation when the live session is mid-run.
 * On accept: cancel + PATCH-archive the live session, then run the action.
 */
export function useConfirmChannelLiveRun(
  issueId: string,
  channel: ConversationChannel,
): {
  confirmIfLiveRun: (action: PendingAction) => void;
  cancelConfirm: () => void;
  /** True while the confirm dialog is open (pending user choice or in-flight retire). */
  awaitingConfirm: boolean;
  confirming: boolean;
  dialog: ReactNode;
} {
  const qc = useQueryClient();
  const { data: sessions } = useChannelSessionsQuery(issueId, channel);
  const live = currentChannelSession(sessions ?? []);
  const midRun = live?.activeRun ? live : undefined;
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearPending = () => {
    setPending(null);
    setError(null);
  };

  const confirmIfLiveRun = (action: PendingAction) => {
    if (!midRun) {
      void action();
      return;
    }
    // Defer so a triggering Select can close before the dialog mounts.
    queueMicrotask(() => {
      setError(null);
      setPending(() => action);
    });
  };

  const cancelConfirm = () => {
    if (confirming) return;
    clearPending();
  };

  const onOpenChange = (open: boolean) => {
    if (!open && !confirming) clearPending();
  };

  const onConfirm = () => {
    if (!midRun || !pending) return;
    const action = pending;
    setConfirming(true);
    setError(null);
    void (async () => {
      try {
        await retireChannelLiveSession(midRun.id);
        qc.setQueryData<ChannelSessionListItem[]>(
          issuesKeys.channelSessions(issueId, channel),
          (prev) => markChannelSessionRetired(prev, midRun.id),
        );
        await action();
        clearPending();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Request failed");
      } finally {
        setConfirming(false);
        void qc.invalidateQueries({
          queryKey: issuesKeys.channelSessions(issueId, channel),
        });
        void qc.invalidateQueries({
          queryKey: agentsKeys.conversationsPrefix(),
        });
      }
    })();
  };

  return {
    confirmIfLiveRun,
    cancelConfirm,
    awaitingConfirm: pending !== null,
    confirming,
    dialog: (
      <ChannelKillLiveRunDialog
        open={pending !== null}
        session={midRun}
        confirming={confirming}
        error={error}
        onOpenChange={onOpenChange}
        onConfirm={onConfirm}
      />
    ),
  };
}
