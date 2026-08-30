import type { ConversationChannel } from "@server/schemas";
import type {
  CockpitLaunchFault,
  CockpitLaunchKind,
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

/** Pending body copy while session-create is in flight. */
export function detailLaunchPendingCopy(kind: CockpitLaunchKind): {
  title: string;
  detail: string;
} {
  if (kind === "work") {
    return {
      title: "Starting the work loop…",
      detail:
        "Session create is in flight. The coordinator transcript will open here once the run is acknowledged.",
    };
  }
  return {
    title: "Starting the planning session…",
    detail:
      "Session create is in flight. The planning transcript will open here once the run is acknowledged.",
  };
}

/** Channel-attached fault after a rejected session-create. */
export function detailLaunchFaultCopy(fault: CockpitLaunchFault): {
  message: string;
  hint: string;
} {
  if (fault.lockHolderTitle != null && fault.status === 409) {
    return {
      message: `Session create rejected — implementing lock held by ${fault.lockHolderTitle} (409).`,
      hint: "Retire the active run on that epic, then return here.",
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
