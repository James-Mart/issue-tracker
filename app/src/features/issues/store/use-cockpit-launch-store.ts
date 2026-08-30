import { useEffect } from "react";
import { create } from "zustand";
import type { DerivedState } from "@server/schemas";
import {
  cockpitLaunchAckIsStale,
  type CockpitLaunchAck,
  type CockpitLaunchFault,
  type CockpitLaunchKind,
  type CockpitLaunchPending,
} from "../lib/cockpit-launch-sync";

type CockpitLaunchState = {
  pending: CockpitLaunchPending | null;
  fault: CockpitLaunchFault | null;
  ack: CockpitLaunchAck | null;
  seenDerived: Record<string, DerivedState> | undefined;
  beginLaunch: (issueId: string, kind: CockpitLaunchKind) => void;
  ackLaunch: (
    issueId: string,
    kind: CockpitLaunchKind,
    session?: CockpitLaunchAck["session"],
  ) => void;
  failLaunch: (
    issueId: string,
    kind: CockpitLaunchKind,
    options?: {
      lockRefusal?: boolean;
      lockHolderTitle?: string;
      status?: number;
      errorMessage?: string;
    },
  ) => void;
  reconcileDerived: (derived: Record<string, DerivedState>) => void;
};

const initialState = {
  pending: null,
  fault: null,
  ack: null,
  seenDerived: undefined as Record<string, DerivedState> | undefined,
};

export const useCockpitLaunchStore = create<CockpitLaunchState>((set, get) => ({
  ...initialState,
  beginLaunch: (issueId, kind) => {
    const { fault, ack } = get();
    set({
      pending: { issueId, kind },
      fault: fault?.issueId === issueId ? null : fault,
      ack: ack?.issueId === issueId ? null : ack,
    });
  },
  ackLaunch: (issueId, kind, session) => {
    const { pending, fault } = get();
    set({
      pending: pending?.issueId === issueId ? null : pending,
      fault: fault?.issueId === issueId ? null : fault,
      ack: { issueId, kind, session },
    });
  },
  failLaunch: (issueId, kind, options) => {
    const { pending, ack, fault } = get();
    set({
      pending: pending?.issueId === issueId ? null : pending,
      ack: ack?.issueId === issueId ? null : ack,
      fault: options?.lockRefusal
        ? fault?.issueId === issueId
          ? null
          : fault
        : {
            issueId,
            kind,
            lockHolderTitle: options?.lockHolderTitle,
            status: options?.status,
            errorMessage: options?.errorMessage,
          },
    });
  },
  reconcileDerived: (derived) => {
    const { seenDerived, ack } = get();
    if (ack && cockpitLaunchAckIsStale(seenDerived, derived)) {
      set({ seenDerived: derived, ack: null });
      return;
    }
    set({ seenDerived: derived });
  },
}));

export function resetCockpitLaunchStore(): void {
  useCockpitLaunchStore.setState({ ...initialState });
}

/** Drop optimistic In-flight placement when GET /api/issues returns a new derived map. */
export function useCockpitLaunchIssuesSync(
  derived: Record<string, DerivedState> | undefined,
): void {
  const reconcileDerived = useCockpitLaunchStore((s) => s.reconcileDerived);
  useEffect(() => {
    if (derived) reconcileDerived(derived);
  }, [derived, reconcileDerived]);
}
