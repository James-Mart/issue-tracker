#!/usr/bin/env -S npx tsx
// One-time setup to invoke this CLI as `issue <verb>` instead of `npx tsx cli.ts <verb>`:
//   cd .cursor/plugins/issue-tracker/app && npm link
import { readFileSync } from "fs";
import { Command } from "commander";
import { parse as parseYaml } from "yaml";
import { list } from "./server/services/issues.js";
import {
  KINDS,
  type DerivedState,
  type IssueRecord,
} from "./server/schemas.js";
import { visibleIssues } from "./server/services/archived-visibility.js";
import { apply } from "./server/services/apply.js";
import {
  parseApplyDoc,
  isStoryDoc,
  isEpicDoc,
  type ApplyDoc,
} from "./server/services/apply-schema.js";
import {
  bySequence,
  buildProjectBoardOf,
  stackedOnSubtree,
} from "./server/order.js";
import {
  assertScopeVisible,
  resolveBoardScope,
  scopeIssueIds,
  type BoardScope,
} from "./server/scope.js";
import { CHIP_UNSET } from "./server/services/merge-base.js";
import { formatSummary, summarize } from "./server/services/summary.js";
import { hasAttention } from "./server/kind.js";
import { registerKindAdd } from "./cli-create.js";
import { registerKindGetSet } from "./cli-kind.js";
import { registerKindOps } from "./cli-ops.js";
import { DELETED_FIELD_VERBS } from "./deleted-field-verbs.js";

type EpicRecord = Extract<IssueRecord, { kind: "epic" }>;
type StoryRecord = Extract<IssueRecord, { kind: "story" }>;
type TaskRecord = Extract<IssueRecord, { kind: "task" }>;
type ProjectBoardChild = Extract<
  IssueRecord,
  { kind: "epic" | "idea" | "story" }
>;

// Shared context for the `tree` renderer: the children of each parent bucketed
// by kind, and the derived state. Tasks are pre-sorted into their execution
// sequence; Story stacks are ordered via `stackedOnSubtree` per root.
interface TreeContext {
  storiesOf: Map<string, StoryRecord[]>;
  tasksOf: Map<string, TaskRecord[]>;
  storyById: Map<string, StoryRecord>;
  derived: Record<string, DerivedState>;
}

function buildTreeContext(
  issues: IssueRecord[],
  derived: Record<string, DerivedState>,
): TreeContext {
  const storiesOf = new Map<string, StoryRecord[]>();
  const tasksOf = new Map<string, TaskRecord[]>();
  const storyById = new Map<string, StoryRecord>();
  for (const issue of issues) {
    if (issue.kind === "story") {
      storyById.set(issue.id, issue);
      const bucket = storiesOf.get(issue.partOf) ?? [];
      bucket.push(issue);
      storiesOf.set(issue.partOf, bucket);
    } else if (issue.kind === "task") {
      const bucket = tasksOf.get(issue.partOf) ?? [];
      bucket.push(issue);
      tasksOf.set(issue.partOf, bucket);
    }
  }
  for (const bucket of tasksOf.values()) bucket.sort(bySequence);
  return { storiesOf, tasksOf, storyById, derived };
}

// The git-stack depth of a Story within its container: how many `stackedOn`
// hops it takes to reach a root Story. Drives the extra indentation a stacked
// Story gets under the one it forks from.
function storyDepth(
  story: StoryRecord,
  inSet: Set<string>,
  storyById: Map<string, StoryRecord>,
): number {
  let depth = 0;
  let current = story;
  const seen = new Set<string>();
  while (current.stackedOn && inSet.has(current.stackedOn) && !seen.has(current.id)) {
    seen.add(current.id);
    const parent = storyById.get(current.stackedOn);
    if (!parent) break;
    current = parent;
    depth += 1;
  }
  return depth;
}

function nodeLine(
  indent: number,
  kind: string,
  id: string,
  title: string,
  chips: string[],
): string {
  const pad = "  ".repeat(indent);
  const tail = chips.length > 0 ? `  [${chips.join(" ")}]` : "";
  return `${pad}${kind} ${id}  ${title}${tail}`;
}

function attentionChip(issue: IssueRecord): string[] {
  if (!hasAttention(issue) || !issue.needsAttention) return [];
  return [`attention=${issue.attentionReason ?? "(no reason)"}`];
}

function labelsChip(issue: { labels?: string[] }): string[] {
  if (!issue.labels?.length) return [];
  return [`labels=${issue.labels.join(",")}`];
}

function epicChips(epic: EpicRecord, derived: Record<string, DerivedState>): string[] {
  const d = derived[epic.id];
  const chips: string[] = [];
  if (d?.epicStatus) chips.push(`status=${d.epicStatus}`);
  if (epic.retro) chips.push(`retro=${epic.retro}`);
  return [...chips, ...labelsChip(epic), ...attentionChip(epic)];
}

function storyChips(story: StoryRecord, derived: Record<string, DerivedState>): string[] {
  const d = derived[story.id];
  const chips: string[] = [];
  if (d?.storyStatus) chips.push(`status=${d.storyStatus}`);
  if (story.specReview) chips.push(`specReview=${story.specReview}`);
  if (story.retro) chips.push(`retro=${story.retro}`);
  chips.push(`mergeBase=${d?.mergeBase ?? CHIP_UNSET}`);
  chips.push(`branch=${story.branchName ?? CHIP_UNSET}`);
  if (story.prUrl) chips.push(`pr=${story.prUrl}`);
  if (story.merged) chips.push("merged");
  if (d?.blocked) chips.push("blocked");
  return [...chips, ...labelsChip(story), ...attentionChip(story)];
}

function taskChips(task: TaskRecord, derived: Record<string, DerivedState>): string[] {
  const chips = [`status=${task.status}`];
  if (task.qa) chips.push(`qa=${task.qa}`);
  if (task.commitSha) chips.push(`sha=${task.commitSha.slice(0, 7)}`);
  if (derived[task.id]?.blocked) chips.push("blocked");
  return [...chips, ...attentionChip(task)];
}

// Render one Story line plus its Tasks (no stacked child Stories).
function renderStory(story: StoryRecord, indent: number, ctx: TreeContext): string[] {
  const lines = [
    nodeLine(indent, "story", story.id, story.title, storyChips(story, ctx.derived)),
  ];
  for (const task of ctx.tasksOf.get(story.id) ?? []) {
    lines.push(
      nodeLine(indent + 1, "task", task.id, task.title, taskChips(task, ctx.derived)),
    );
  }
  return lines;
}

// Render an ordered Story stack (root + stacked descendants) with indentation
// from `stackedOn` depth. Shared by Epic and project-board Story roots.
function renderStoryStack(
  stories: StoryRecord[],
  baseIndent: number,
  ctx: TreeContext,
): string[] {
  const inSet = new Set(stories.map((s) => s.id));
  const lines: string[] = [];
  for (const story of stories) {
    const level = baseIndent + storyDepth(story, inSet, ctx.storyById);
    lines.push(...renderStory(story, level, ctx));
  }
  return lines;
}

function renderStoryStackFromRoot(
  root: StoryRecord,
  baseIndent: number,
  ctx: TreeContext,
): string[] {
  return renderStoryStack(
    stackedOnSubtree(ctx.storiesOf.get(root.partOf) ?? [], root.id),
    baseIndent,
    ctx,
  );
}

function renderBoardChild(
  child: ProjectBoardChild,
  indent: number,
  ctx: TreeContext,
): string[] {
  if (child.kind === "idea") {
    return [nodeLine(indent, "idea", child.id, child.title, labelsChip(child))];
  }
  if (child.kind === "story") {
    return renderStoryStackFromRoot(child, indent, ctx);
  }
  return renderEpic(child, indent, ctx);
}

function renderProjectBoard(
  project: Extract<IssueRecord, { kind: "project" }>,
  boardChildren: ProjectBoardChild[],
  ctx: TreeContext,
  indent: number,
): string[] {
  const lines = [nodeLine(indent, "project", project.id, project.title, [])];
  for (const child of boardChildren) {
    lines.push(...renderBoardChild(child, indent + 1, ctx));
  }
  return lines;
}

// Render one Epic subtree starting at `indent`. Root Stories (and each stack)
// use the same helper as project-board Stories.
function renderEpic(epic: EpicRecord, indent: number, ctx: TreeContext): string[] {
  const lines = [
    nodeLine(indent, "epic", epic.id, epic.title, epicChips(epic, ctx.derived)),
  ];
  const containerStories = ctx.storiesOf.get(epic.id) ?? [];
  const inSet = new Set(containerStories.map((s) => s.id));
  const roots = containerStories
    .filter((s) => !s.stackedOn || !inSet.has(s.stackedOn))
    .sort(bySequence);
  for (const root of roots) {
    lines.push(...renderStoryStackFromRoot(root, indent + 1, ctx));
  }
  return lines;
}

function renderProjects(
  issues: IssueRecord[],
  ctx: TreeContext,
  projectId?: string,
): string[] {
  const boardOf = buildProjectBoardOf(issues);
  const projects = issues
    .filter((issue): issue is Extract<IssueRecord, { kind: "project" }> =>
      issue.kind === "project" && (!projectId || issue.id === projectId),
    )
    .sort(bySequence);

  const lines: string[] = [];
  for (const project of projects) {
    lines.push(...renderProjectBoard(project, boardOf.get(project.id) ?? [], ctx, 0));
  }
  return lines;
}

function renderTreeScope(
  scope: BoardScope,
  issues: IssueRecord[],
  ctx: TreeContext,
): string[] {
  switch (scope.kind) {
    case "story":
      return renderStory(scope.story, 0, ctx);
    case "epic": {
      const epic = issues.find(
        (issue) => issue.id === scope.epicId && issue.kind === "epic",
      );
      if (!epic) throw new Error(`unknown epic "${scope.epicId}"`);
      return renderEpic(epic, 0, ctx);
    }
    case "project":
      return renderProjects(issues, ctx, scope.projectId);
    case "all":
      return renderProjects(issues, ctx);
  }
}

// Render the subtree an `apply` doc is rooted at (Project, Epic, or Branch), so
// `apply` can echo the resulting shape the way `tree` would for the same scope.
function renderApplyRoot(doc: ApplyDoc, issues: IssueRecord[], ctx: TreeContext): string[] {
  if (isStoryDoc(doc)) {
    const story = ctx.storyById.get(doc.story.id);
    return story ? renderStory(story, 0, ctx) : [];
  }
  if (isEpicDoc(doc)) {
    const epic = issues.find((i) => i.id === doc.epic.id && i.kind === "epic");
    return epic ? renderEpic(epic, 0, ctx) : [];
  }
  const projectId = doc.project.id;
  const project = issues.find((i) => i.id === projectId && i.kind === "project");
  if (!project) return [];
  const boardOf = buildProjectBoardOf(issues);
  return renderProjectBoard(project, boardOf.get(projectId) ?? [], ctx, 0);
}

const program = new Command();
program
  .name("issue")
  .description("File-backed Epic > Story > Task tracker")
  .showHelpAfterError();

async function run(action: () => unknown): Promise<void> {
  try {
    const result = await action();
    if (result && typeof result === "object" && "id" in result) {
      console.log((result as { id: string }).id);
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

for (const kind of KINDS) {
  const kindCmd = registerKindGetSet(program, kind, run);
  registerKindAdd(kindCmd, kind, run);
  registerKindOps(kindCmd, kind, run);
}

program
  .command("apply")
  .argument("<file>", "path to the nested YAML doc to apply")
  .description(
    "upsert a nested YAML tree rooted at a Project (whole tree), an Epic (one epic in an existing project), or a Story (one story + its tasks under an existing Epic or Project); prunes within the declared root's subtree only; omitting a restated Epic's blockedBy clears it to []",
  )
  .action((file) =>
    run(async () => {
      const raw = parseYaml(readFileSync(file, "utf8"));
      const parsed = parseApplyDoc(raw);
      if (!parsed.ok) throw new Error(parsed.message);
      const summary = await apply(parsed.doc);
      const line = (label: string, ids: string[]): string =>
        `${label}: ${ids.length}${ids.length ? ` (${ids.join(", ")})` : ""}`;
      console.log(line("created", summary.created));
      console.log(line("updated", summary.updated));
      console.log(line("deleted", summary.deleted));

      // Echo the resulting subtree the doc is rooted at, so callers don't have
      // to follow up with a separate `tree` invocation.
      const { issues, derived } = list();
      const treeLines = renderApplyRoot(parsed.doc, issues, buildTreeContext(issues, derived));
      if (treeLines.length > 0) {
        console.log();
        console.log(treeLines.join("\n"));
      }
    }),
  );

program
  .command("summary")
  .argument("<id>", "issue id (task, story, epic, idea, or project)")
  .description(
    "print the Project → … → target chain for agent bootstrap (e.g. Project → Idea, Project → Story → Task, or Project → Epic → Story → Task)",
  )
  .action((id) =>
    run(() => {
      console.log(formatSummary(summarize(id)));
    }),
  );

program
  .command("list")
  .description(
    "print issues, derived state, and any problems as JSON (optional id scopes like tree)",
  )
  .argument(
    "[id]",
    "scope by issue id (project/epic/story subtree; idea/task refused; omit for all projects)",
  )
  .option("--show-archived", "include archived Epic / Idea / Story / Task issues")
  .action((id, opts) =>
    run(() => {
      const full = list();
      // Resolve scope against the full graph so archived ids remain addressable,
      // then filter to the visible subset (unless --show-archived).
      const scope = resolveBoardScope(id, full.issues, "list");
      const showArchived = Boolean(opts.showArchived);
      const inScope = scopeIssueIds(scope, full.issues);
      const scopedIssues = visibleIssues(
        full.issues.filter((issue) => inScope.has(issue.id)),
        showArchived,
      );
      const visibleIds = new Set(scopedIssues.map((issue) => issue.id));
      if (!showArchived) assertScopeVisible(scope, visibleIds);
      const scoped = {
        issues: scopedIssues,
        problems: full.problems.filter((problem) => visibleIds.has(problem.id)),
        derived: Object.fromEntries(
          Object.entries(full.derived).filter(([issueId]) => visibleIds.has(issueId)),
        ),
      };
      console.log(JSON.stringify(scoped, null, 2));
    }),
  );

program
  .command("tree")
  .description(
    "print an indented Project outline (Epics, Ideas, and project-level Stories interleaved by order; Stories show Task subtrees with derived chips)",
  )
  .argument(
    "[id]",
    "scope by issue id (project/epic/story subtree; idea/task refused; omit for all projects)",
  )
  .option("--show-archived", "include archived Epic / Idea / Story / Task issues")
  .action((id, opts) =>
    run(() => {
      const { issues: allIssues, derived } = list();
      // Resolve scope against the full graph so archived ids remain addressable,
      // then render only the visible subset (unless --show-archived).
      const scope = resolveBoardScope(id, allIssues, "tree");
      const showArchived = Boolean(opts.showArchived);
      const issues = visibleIssues(allIssues, showArchived);
      const visibleIds = new Set(issues.map((issue) => issue.id));
      if (!showArchived) assertScopeVisible(scope, visibleIds);
      const visibleDerived = Object.fromEntries(
        Object.entries(derived).filter(([issueId]) => visibleIds.has(issueId)),
      );
      const ctx = buildTreeContext(issues, visibleDerived);
      const lines = renderTreeScope(scope, issues, ctx);
      if (lines.length === 0) {
        console.log("no projects");
        return;
      }
      console.log(lines.join("\n"));
    }),
  );

for (const verb of DELETED_FIELD_VERBS) {
  if (program.commands.some((cmd) => cmd.name() === verb)) {
    throw new Error(`deleted field verb "${verb}" must not be registered`);
  }
}

program.parseAsync(process.argv);
