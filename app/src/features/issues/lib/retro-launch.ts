import type { ConversationChannel, IssueDetail, IssueKind } from "@server/schemas";
import { skillPath } from "@/lib/plugin-paths";
import { isImplementingWorkRoot, type ImplementingWorkRoot } from "./implementing-launch";

export type RetroWorkRoot = {
  id: string;
  title: string;
};

/** First prompt naming the work root and retro skill to load. */
export function retroSessionMessage(
  workRootId: string,
  workRootTitle: string,
): string {
  return (
    `Run retro on ${workRootId} (${workRootTitle}) in the issue tracker ` +
    `using the issue-tracker-retro skill. ` +
    `Read ${skillPath("issue-tracker-retro")} and follow it.`
  );
}

/** Work root for retro on an implementing channel — the anchored issue. */
export function implementingRetroWorkRoot(
  channel: ConversationChannel,
  issue: IssueDetail | undefined,
  parentKind?: IssueKind,
): RetroWorkRoot | undefined {
  if (!isImplementingWorkRoot(channel, issue, parentKind)) return undefined;
  const root = issue as ImplementingWorkRoot;
  return { id: root.id, title: root.title };
}
