import type { DerivedState, IssueRecord } from "@server/schemas";

export type CockpitLaunchKind = "work" | "planning";

export type CockpitLaunchPending = {
  issueId: string;
  kind: CockpitLaunchKind;
};

export type CockpitLaunchFault = {
  issueId: string;
  kind: CockpitLaunchKind;
  lockHolderTitle?: string;
  status?: number;
  errorMessage?: string;
};

export type CockpitLaunchAckSession = {
  id: string;
  title: string;
  model: string;
};

export type CockpitLaunchAck = {
  issueId: string;
  kind: CockpitLaunchKind;
  session?: CockpitLaunchAckSession;
};

/** Pending or ack overlay for the same issue — both flip status the same way. */
export function cockpitLaunchOverlayForIssue(
  issueId: string,
  pending: CockpitLaunchPending | null,
  ack: CockpitLaunchAck | null,
): CockpitLaunchPending | CockpitLaunchAck | null {
  if (pending?.issueId === issueId) return pending;
  if (ack?.issueId === issueId) return ack;
  return null;
}

/** Row-attached copy after a failed cockpit session-create. */
export function cockpitLaunchFaultMessage(
  title: string,
  kind: CockpitLaunchKind,
): string {
  if (kind === "work") {
    return `${title} — Work loop didn't start. Start work again.`;
  }
  return `${title} — Planning session didn't start. Begin planning again.`;
}

/**
 * Optimistic In-flight overlay after session-create ack. Applies only to the
 * launched work-root — nested story rails stay on server-derived status.
 */
export function overlayCockpitLaunchAck(
  derived: Record<string, DerivedState>,
  issues: readonly IssueRecord[],
  ack: CockpitLaunchAck,
): Record<string, DerivedState> {
  const issue = issues.find((candidate) => candidate.id === ack.issueId);
  if (!issue) return derived;
  const current = derived[ack.issueId] ?? { blocked: false };
  if (ack.kind === "planning") {
    if (issue.kind !== "idea") return derived;
    return {
      ...derived,
      [ack.issueId]: { ...current, liveRun: true, ideaStatus: "planning" },
    };
  }
  if (issue.kind === "epic") {
    return {
      ...derived,
      [ack.issueId]: { ...current, liveRun: true, epicStatus: "in-progress" },
    };
  }
  if (issue.kind === "story") {
    return {
      ...derived,
      [ack.issueId]: { ...current, liveRun: true, storyStatus: "in-progress" },
    };
  }
  return derived;
}

/** True when a later issues payload replaced the one the ack was based on. */
export function cockpitLaunchAckIsStale(
  previousDerived: Record<string, DerivedState> | undefined,
  nextDerived: Record<string, DerivedState>,
): boolean {
  return previousDerived !== undefined && previousDerived !== nextDerived;
}
