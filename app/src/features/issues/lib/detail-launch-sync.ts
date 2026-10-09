import type { ConversationChannel } from "@server/schemas";
import type {
  CockpitLaunchFault,
  CockpitLaunchKind,
  CockpitLaunchPending,
} from "./cockpit-launch-sync";

/** Channel tab the Issue detail launch instrument drives for a launch kind. */
export function channelForLaunchKind(
  kind: CockpitLaunchKind,
): ConversationChannel {
  return kind === "work" ? "implementing" : "planning";
}

/** True when pending/ack should light this issue's channel instrument. */
export function launchOverlaysChannel(
  issueId: string,
  channel: ConversationChannel,
  overlay: { issueId: string; kind: CockpitLaunchKind } | null | undefined,
): boolean {
  if (!overlay || overlay.issueId !== issueId) return false;
  return channelForLaunchKind(overlay.kind) === channel;
}

/** Waiting line on both channel tabs while the launch's session does not exist yet. */
const LAUNCH_WAITING_LINE =
  "The transcript opens here as soon as the session appears.";

/** Pending body copy while a new launch's session does not exist yet. */
export function detailLaunchPendingCopy(kind: CockpitLaunchKind): {
  title: string;
  detail: string;
} {
  if (kind === "work") {
    return {
      title: "Starting the work loop…",
      detail: LAUNCH_WAITING_LINE,
    };
  }
  return {
    title: "Starting the planning session…",
    detail: LAUNCH_WAITING_LINE,
  };
}

type LaunchSessionCandidate = {
  id: string;
  createdAt: string;
  archived: boolean;
};

function createdBeforeLaunch(createdAt: string, startedAt: string): boolean {
  return createdAt.localeCompare(startedAt) < 0;
}

/**
 * List row for the session this launch should show.
 * A resume is that id when the list already has it. A new launch is the
 * newest non-archived session created at or after the launch began.
 * Undefined means the row is not in the list yet: a new launch still waits,
 * and a resume uses its stored id until the list catches up.
 */
export function launchTranscriptSession<T extends LaunchSessionCandidate>(
  pending: Pick<CockpitLaunchPending, "startedAt" | "resumeSession">,
  sessions: readonly T[],
): T | undefined {
  if (pending.resumeSession) {
    return sessions.find((session) => session.id === pending.resumeSession?.id);
  }
  let match: T | undefined;
  for (const session of sessions) {
    if (
      session.archived ||
      createdBeforeLaunch(session.createdAt, pending.startedAt)
    ) {
      continue;
    }
    if (
      !match ||
      session.createdAt.localeCompare(match.createdAt) > 0
    ) {
      match = session;
    }
  }
  return match;
}

/** Channel-attached fault after a rejected session-create. */
export function detailLaunchFaultCopy(fault: CockpitLaunchFault): {
  message: string;
  hint: string;
} {
  if (fault.lockHolderTitle != null && fault.status === 409) {
    return {
      message: `Session create rejected — implementing lock held by ${fault.lockHolderTitle} (409).`,
      hint: "Start the work loop again.",
    };
  }
  const why = fault.errorMessage?.trim() || "the session was not created";
  if (fault.kind === "work") {
    return {
      message: `Session create rejected — ${why}.`,
      hint: "Start the work loop again.",
    };
  }
  return {
    message: `Session create rejected — ${why}.`,
    hint: "Start the planning session again.",
  };
}
