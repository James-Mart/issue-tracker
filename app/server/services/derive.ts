import type {
  StoryStatus,
  DerivedState,
  EpicStatus,
  Issue,
  Problem,
} from "../schemas.js";
import { bySequence } from "../order.js";
import { resolveMergeBase } from "../resolve-merge-base.js";
import { checkIntegrity } from "./integrity.js";

export interface DeriveResult {
  byId: Record<string, DerivedState>;
  problems: Problem[];
}

// An Epic counts as "done" (and so stops blocking its dependents) once its
// derived status is `done` — all its Stories merged. The single source for
// this predicate: consumed by the blocked pass below and by the UI's
// per-dependency badge so both read the same rule.
export function epicIsDone(state: DerivedState | undefined): boolean {
  return state?.epicStatus === "done";
}

type Story = Extract<Issue, { kind: "story" }>;
type Task = Extract<Issue, { kind: "task" }>;

export function derive(issues: Issue[]): DeriveResult {
  const problems = checkIntegrity(issues);
  const byId = new Map(issues.map((issue) => [issue.id, issue]));

  const tasksOf = new Map<string, Task[]>();
  const storiesOf = new Map<string, Story[]>();
  for (const issue of issues) {
    if (issue.kind === "task") {
      const bucket = tasksOf.get(issue.partOf) ?? [];
      bucket.push(issue);
      tasksOf.set(issue.partOf, bucket);
    } else if (issue.kind === "story") {
      const bucket = storiesOf.get(issue.partOf) ?? [];
      bucket.push(issue);
      storiesOf.set(issue.partOf, bucket);
    }
  }
  for (const bucket of tasksOf.values()) bucket.sort(bySequence);

  const state: Record<string, DerivedState> = {};

  // A stacked Story forks its parent's tip, so it is not blocked once the parent's
  // tip exists (it has a `branchName`) and the parent's tasks are all `done`
  // (no merge gate). A parent with no `branchName` is not-started: there is no
  // tip to fork yet, so the child stays blocked (guarding against the vacuous
  // `[].every(...)` on a parent with zero tasks). A root Story (no
  // `stackedOn`) has no parent to wait on and is not blocked.
  const parentTipDone = (story: Story): boolean => {
    if (!story.stackedOn) return true;
    const parent = byId.get(story.stackedOn);
    if (parent?.kind !== "story") return false;
    if (!parent.branchName) return false;
    return (tasksOf.get(parent.id) ?? []).every((t) => t.status === "done");
  };

  const storyStatusOf = (story: Story): StoryStatus => {
    if (story.merged) return "merged";
    const children = tasksOf.get(story.id) ?? [];
    const allDone = children.every((t) => t.status === "done");
    if (children.length > 0 && allDone && story.prUrl) return "pr-open";
    if (story.branchName) return "in-progress";
    return "not-started";
  };

  const storiesById = new Map<string, Story>();
  for (const issue of issues) {
    if (issue.kind === "story") storiesById.set(issue.id, issue);
  }
  // Cache by fork-point id so siblings sharing a parent don't re-walk chains.
  const mergeBaseByStackedOn = new Map<string | undefined, string | undefined>();
  const mergeBaseFor = (stackedOn: string | undefined): string | undefined => {
    if (mergeBaseByStackedOn.has(stackedOn)) {
      return mergeBaseByStackedOn.get(stackedOn);
    }
    const value = resolveMergeBase(stackedOn, issues, storiesById);
    mergeBaseByStackedOn.set(stackedOn, value);
    return value;
  };

  for (const story of storiesById.values()) {
    const storyStatus = storyStatusOf(story);
    const mergeBase = mergeBaseFor(story.stackedOn);
    state[story.id] = {
      blocked: storyStatus === "not-started" && !parentTipDone(story),
      storyStatus,
      ...(mergeBase !== undefined ? { mergeBase } : {}),
    };
  }

  for (const task of issues.filter((i): i is Task => i.kind === "task")) {
    const story = byId.get(task.partOf);
    const hasStory =
      story?.kind === "story" && Boolean(story.branchName) && !story.merged;
    const siblings = tasksOf.get(task.partOf) ?? [];
    const earlierDone = siblings
      .slice(0, siblings.indexOf(task))
      .every((t) => t.status === "done");
    state[task.id] = {
      blocked: task.status === "todo" && !(hasStory && earlierDone),
    };
  }

  const epics = issues.filter((i) => i.kind === "epic");
  for (const epic of epics) {
    const stories = storiesOf.get(epic.id) ?? [];
    const started = stories.filter(
      (s) => state[s.id]?.storyStatus !== "not-started",
    );
    const epicStatus: EpicStatus =
      stories.length > 0 && stories.every((s) => s.merged)
        ? "done"
        : started.length > 0
          ? "in-progress"
          : "todo";
    state[epic.id] = { blocked: false, epicStatus };
  }

  // An Epic is blocked while any Epic it `blockedBy` is not done (done = all its
  // Stories merged). Computed in a second pass so every Epic's status is known.
  for (const epic of epics) {
    const derived = state[epic.id];
    if (derived)
      derived.blocked = epic.blockedBy.some((dep) => !epicIsDone(state[dep]));
  }

  return { byId: state, problems };
}
