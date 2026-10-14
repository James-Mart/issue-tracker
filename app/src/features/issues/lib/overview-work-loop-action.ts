import type { ChannelSessionListItem } from "@server/schemas";

export type OverviewWorkLoopAction =
  | { action: "queue" }
  | { action: "resume"; resumeSession: ChannelSessionListItem }
  | { action: "unpark" }
  | { action: "hidden" };

/**
 * Overview launch control.
 * Waiting is hidden. A parked root shows Play to rejoin the waiting roots.
 * A paused slot-holder resumes into its coordinator.
 * Anything else that can still be queued shows the queue control.
 */
export function overviewWorkLoopAction(input: {
  liveRun: boolean;
  leafTasks: readonly { status: string }[];
  currentSession: ChannelSessionListItem | undefined;
  queued: boolean;
  holdsSlot: boolean;
  parked: boolean;
  finished: boolean;
  archived: boolean;
}): OverviewWorkLoopAction {
  if (input.finished || input.archived) {
    return { action: "hidden" };
  }
  if (input.parked) {
    return { action: "unpark" };
  }
  if (input.queued && !input.holdsSlot) {
    return { action: "hidden" };
  }
  if (input.holdsSlot) {
    if (input.liveRun || input.currentSession === undefined) {
      return { action: "hidden" };
    }
    if (input.leafTasks.every((task) => task.status === "done")) {
      return { action: "hidden" };
    }
    return { action: "resume", resumeSession: input.currentSession };
  }
  if (
    input.currentSession !== undefined &&
    input.leafTasks.every((task) => task.status === "done")
  ) {
    return { action: "hidden" };
  }
  return { action: "queue" };
}
