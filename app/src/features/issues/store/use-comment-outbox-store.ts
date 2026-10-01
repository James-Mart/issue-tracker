import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { CommentDelivery, OutboxComment } from "../lib/comment-outbox";

type CommentOutboxState = {
  byClientId: Record<string, OutboxComment>;
  enqueue: (entry: OutboxComment) => void;
  setDelivery: (clientId: string, delivery: CommentDelivery) => void;
  /** Drop copies whose stored record the issue's comments list now carries. */
  reconcile: (issueId: string, stored: Set<string>) => void;
};

const initialByClientId: Record<string, OutboxComment> = {};

export const useCommentOutboxStore = create<CommentOutboxState>((set) => ({
  byClientId: initialByClientId,
  enqueue: (entry) =>
    set((state) => ({
      byClientId: { ...state.byClientId, [entry.clientId]: entry },
    })),
  setDelivery: (clientId, delivery) =>
    set((state) => {
      const entry = state.byClientId[clientId];
      // Reconcile already dropped a copy whose stored record arrived first.
      if (!entry) return state;
      return {
        byClientId: { ...state.byClientId, [clientId]: { ...entry, delivery } },
      };
    }),
  reconcile: (issueId, stored) =>
    set((state) => {
      const drop = Object.values(state.byClientId).filter(
        (entry) => entry.issueId === issueId && stored.has(entry.clientId),
      );
      if (drop.length === 0) return state;
      const byClientId = { ...state.byClientId };
      for (const entry of drop) delete byClientId[entry.clientId];
      return { byClientId };
    }),
}));

/** This issue's outbox copies, oldest first. */
export function useIssueCommentOutbox(issueId: string): OutboxComment[] {
  return useCommentOutboxStore(
    useShallow((state) =>
      Object.values(state.byClientId).filter((entry) => entry.issueId === issueId),
    ),
  );
}

export function resetCommentOutboxStore(): void {
  useCommentOutboxStore.setState({ byClientId: {} });
}
