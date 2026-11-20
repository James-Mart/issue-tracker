import type { Issue } from "../schemas.js";

/** Outline id stored on a Story, when `issue` is that Story and has one. */
export function outlineIdOnStory(issue: Issue | undefined): string | undefined {
  if (issue?.kind !== "story") return undefined;
  return issue.sourceOutline?.outline;
}

/** Outline id on the append-target Story, when that Story stores one. */
export function appendTargetOutlineId(
  issues: readonly Issue[],
  storyId: string,
): string | undefined {
  return outlineIdOnStory(issues.find((issue) => issue.id === storyId));
}
