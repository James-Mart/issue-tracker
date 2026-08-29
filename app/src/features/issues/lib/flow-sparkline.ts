import type { EpicStatus, StoryStatus } from "@server/schemas";
import {
  EPIC_STATUS_LABEL,
  isIssueComplete,
  STORY_STATUS_LABEL,
} from "./derived";
import type { FlowItem } from "./flow";
import type { SparklineStage } from "@/components/ui/progress-sparkline";

const STORY_STAGES: readonly StoryStatus[] = [
  "not-started",
  "in-progress",
  "pr-open",
  "merged",
];

const EPIC_STAGES: readonly EpicStatus[] = ["todo", "in-progress", "done"];

const IDEA_STAGE_NAMES = ["captured", "planning", "planned"] as const;

function tonesForIndex(
  names: readonly string[],
  currentIndex: number,
  complete: boolean,
): SparklineStage[] {
  return names.map((name, index) => ({
    name,
    tone:
      complete || index < currentIndex
        ? "done"
        : index === currentIndex
          ? "current"
          : "idle",
  }));
}

/**
 * Lifecycle sparkline for moving cockpit work. Ready, captured, and attention
 * stalls stay undefined — those rows use the rail disc and demand icon instead.
 */
export function flowItemSparkline(
  item: FlowItem,
): SparklineStage[] | undefined {
  const { issue, state } = item;
  if (issue.kind === "story") {
    const status = state?.storyStatus;
    const complete = isIssueComplete(issue, state);
    if (!complete && status !== "in-progress" && status !== "pr-open") {
      return undefined;
    }
    const index = status ? STORY_STAGES.indexOf(status) : 0;
    return tonesForIndex(
      STORY_STAGES.map((stage) => STORY_STATUS_LABEL[stage]),
      index < 0 ? 0 : index,
      complete,
    );
  }
  if (issue.kind === "epic") {
    const status = state?.epicStatus;
    const complete = isIssueComplete(issue, state);
    if (!complete && status !== "in-progress") return undefined;
    const index = status ? EPIC_STAGES.indexOf(status) : 0;
    return tonesForIndex(
      EPIC_STAGES.map((stage) => EPIC_STATUS_LABEL[stage]),
      index < 0 ? 0 : index,
      complete,
    );
  }
  if (issue.kind === "idea" && state?.ideaStatus === "planning") {
    return tonesForIndex(IDEA_STAGE_NAMES, 1, false);
  }
  return undefined;
}
