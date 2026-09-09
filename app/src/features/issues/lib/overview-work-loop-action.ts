import type { ChannelSessionListItem } from "@server/schemas";

export type OverviewWorkLoopAction =
  | { action: "start" }
  | { action: "resume"; resumeSession: ChannelSessionListItem }
  | { action: "hidden" };

export function overviewWorkLoopAction(input: {
  liveRun: boolean;
  leafTasks: readonly { status: string }[];
  currentSession: ChannelSessionListItem | undefined;
}): OverviewWorkLoopAction {
  if (input.liveRun) {
    return { action: "hidden" };
  }
  if (input.currentSession === undefined) {
    return { action: "start" };
  }
  if (input.leafTasks.every((task) => task.status === "done")) {
    return { action: "hidden" };
  }
  return { action: "resume", resumeSession: input.currentSession };
}
