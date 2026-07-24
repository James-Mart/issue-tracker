import { z } from "zod";
import type { Issue } from "../schemas.js";
import { formatZodError } from "../schemas.js";
import { SLUG_RE } from "./slug.js";

// The declarative `apply` doc describes a Project > Epic|Idea|Story > Task tree
// in one nested document. Every nest uses `children:` with an explicit `kind`
// on each entry. Root nodes omit `kind` — the form key (`project` / `epic` /
// `story`) implies it. `partOf` is inferred from the enclosing container and
// `stackedOn` from a `kind: story` nested under another Story; only `blockedBy`
// (an Epic-level cross-Epic dep list) uses explicit id references. Every node
// carries a mandatory author-chosen kebab `id` so re-apply is stable across
// retitles.

// Ids must be slug-safe: the same shape `slugify()` produces (see `SLUG_RE` in
// slug.ts), so auto-slugs and author-chosen ids stay aligned.
const idField = z
  .string()
  .regex(
    SLUG_RE,
    "id must be kebab-case (lowercase letters and digits, single hyphens, no leading/trailing hyphen)",
  );
const titleField = z.string().min(1, "title is required");
const descriptionField = z.string().optional();

const taskChildNode = z
  .object({
    kind: z.literal("task"),
    id: idField,
    title: titleField,
    description: descriptionField,
  })
  .strict();

export type TaskNode = z.infer<typeof taskChildNode>;

// A story may nest tasks and stacked stories to any depth, so its node is
// recursive; the explicit interface pins the type for `z.lazy`.
export interface StoryNode {
  kind: "story";
  id: string;
  title: string;
  description?: string;
  children?: Array<TaskNode | StoryNode>;
}

// Entry under a Story's `children:` — task or nested (stacked) story.
const storyNestEntryNode: z.ZodType<TaskNode | StoryNode> = z.lazy(() =>
  z.discriminatedUnion("kind", [taskChildNode, storyNode]),
);

const storyNode: z.ZodType<StoryNode> = z.lazy(() =>
  z
    .object({
      kind: z.literal("story"),
      id: idField,
      title: titleField,
      description: descriptionField,
      children: z.array(storyNestEntryNode).optional(),
    })
    .strict(),
);

const epicFields = {
  id: idField,
  title: titleField,
  description: descriptionField,
  // `blockedBy` references other Epic ids, so hold it to the same kebab rule.
  blockedBy: z.array(idField).optional(),
  // Epic → story only.
  children: z.array(storyNode).optional(),
};

// Epic-rooted docs nest under `epic:`; kind is implied by that root key.
const epicNode = z.object(epicFields).strict();

export type EpicNode = z.infer<typeof epicNode>;

// Project `children:` entries declare kind explicitly so Epics, Ideas, and
// project-level Stories can interleave in one shared Project-child order group.
const epicChildNode = epicNode.extend({ kind: z.literal("epic") });

const ideaChildNode = z
  .object({
    kind: z.literal("idea"),
    id: idField,
    title: titleField,
    description: descriptionField,
  })
  .strict();

type IdeaChildNode = z.infer<typeof ideaChildNode>;
export type EpicChildNode = z.infer<typeof epicChildNode>;
type ProjectChildNode = EpicChildNode | IdeaChildNode | StoryNode;

const projectChildNode = z.discriminatedUnion("kind", [
  epicChildNode,
  ideaChildNode,
  storyNode,
]);

// Single dispatch for Project `children:` so collectIds / flatten stay aligned.
function forEachProjectChild(
  children: ProjectChildNode[] | undefined,
  visit: {
    idea: (idea: IdeaChildNode, index: number) => void;
    story: (story: StoryNode, index: number) => void;
    epic: (epic: EpicChildNode, index: number) => void;
  },
): void {
  (children ?? []).forEach((child, index) => {
    if (child.kind === "idea") visit.idea(child, index);
    else if (child.kind === "story") visit.story(child, index);
    else visit.epic(child, index);
  });
}

// Single dispatch for Story `children:` (task | nested story). RootStoryNode
// children are task-only, so the story visitor is a no-op there.
function forEachStoryChild(
  children: Array<TaskNode | StoryNode> | undefined,
  visit: {
    task: (task: TaskNode, index: number) => void;
    story: (story: StoryNode, index: number) => void;
  },
): void {
  (children ?? []).forEach((child, index) => {
    if (child.kind === "task") visit.task(child, index);
    else visit.story(child, index);
  });
}

// A story-rooted doc reconciles only the story's own subtree (the story plus
// its tasks). Stacked children live under the *container* (`partOf` the Epic
// or Project, not the story), so they are outside a story's subtree and cannot
// be declared here — hence children may only be `kind: task`.
const rootStoryNode = z
  .object({
    id: idField,
    title: titleField,
    description: descriptionField,
    children: z.array(taskChildNode).optional(),
  })
  .strict();

export type RootStoryNode = z.infer<typeof rootStoryNode>;

const projectNode = z
  .object({
    id: idField,
    title: titleField,
    description: descriptionField,
    children: z.array(projectChildNode).optional(),
  })
  .strict();

// The doc may be rooted at a Project, an Epic, or a Story. The root node is
// upserted and pruned within its own subtree; any enclosing parent (named by id)
// is a reference that must already exist and is never upserted or pruned. Forms
// are told apart by which root key holds an object (see `parseApplyDoc`).
// Story form: `project` + `story` always; optional `epic` string scopes the
// Story under an Epic. Omit `epic` for a project-level Story (`partOf` Project).
const projectApplyDoc = z.object({ project: projectNode }).strict();
const epicApplyDoc = z.object({ project: idField, epic: epicNode }).strict();
const storyApplyDoc = z
  .object({
    project: idField,
    epic: idField.optional(),
    story: rootStoryNode,
  })
  .strict();

export type ProjectApplyDoc = z.infer<typeof projectApplyDoc>;
export type EpicApplyDoc = z.infer<typeof epicApplyDoc>;
export type StoryApplyDoc = z.infer<typeof storyApplyDoc>;
export type ApplyDoc = ProjectApplyDoc | EpicApplyDoc | StoryApplyDoc;

// A story-rooted doc is the only one with a `story` key; an epic-rooted doc
// is the only remaining one with an object `epic` key. Anything else is
// project-rooted.
export function isStoryDoc(doc: ApplyDoc): doc is StoryApplyDoc {
  return "story" in doc;
}
export function isEpicDoc(doc: ApplyDoc): doc is EpicApplyDoc {
  return "epic" in doc && !("story" in doc);
}

// The doc-owned subset of each Issue kind (the fields `apply` is allowed to
// write), derived from the canonical `Issue` union so it can never drift from
// the stored schema. `apply` never touches runtime/progress fields.
type DocKeys = "id" | "kind" | "title" | "partOf" | "stackedOn" | "blockedBy";
export type DesiredIssue = Issue extends infer T
  ? T extends Issue
    ? Pick<T, Extract<keyof T, DocKeys>> & { description?: string; order?: number }
    : never
  : never;

export type ApplyParseResult =
  | { ok: true; doc: ApplyDoc }
  | { ok: false; message: string };

function collectIds(doc: ApplyDoc): string[] {
  const ids: string[] = [];
  const visitStory = (story: StoryNode | RootStoryNode): void => {
    ids.push(story.id);
    forEachStoryChild(story.children, {
      task: (task) => ids.push(task.id),
      story: (nested) => visitStory(nested),
    });
  };
  const visitEpic = (epic: EpicNode | EpicChildNode): void => {
    ids.push(epic.id);
    for (const story of epic.children ?? []) visitStory(story);
  };
  if (isStoryDoc(doc)) {
    visitStory(doc.story);
    return ids;
  }
  if (isEpicDoc(doc)) {
    visitEpic(doc.epic);
    return ids;
  }
  ids.push(doc.project.id);
  forEachProjectChild(doc.project.children, {
    idea: (idea) => ids.push(idea.id),
    story: (story) => visitStory(story),
    epic: (epic) => visitEpic(epic),
  });
  return ids;
}

function firstDuplicate(ids: string[]): string | undefined {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) return id;
    seen.add(id);
  }
  return undefined;
}

// Parse + validate an already-decoded (e.g. from YAML) doc value: shape, kebab
// ids, and cross-doc id uniqueness. Returns a clear message instead of throwing
// so callers can surface it verbatim. Old YAML keys (`branches`/`commits`/
// rooted `branch:` / project `epics:`) are rejected — no dual-key accept.
export function parseApplyDoc(raw: unknown): ApplyParseResult {
  // Route to the specific form by root-key shape before parsing so validation
  // errors point at the intended form rather than a noisy union aggregate.
  const keyed = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  if ("branch" in keyed) {
    return {
      ok: false,
      message: 'rooted "branch:" is no longer accepted; use "story:"',
    };
  }
  const projectVal = keyed.project;
  if (
    projectVal &&
    typeof projectVal === "object" &&
    !Array.isArray(projectVal) &&
    "epics" in projectVal
  ) {
    return {
      ok: false,
      message:
        'project "epics:" is no longer accepted; use "children:" with kind: epic | idea | story',
    };
  }
  const schema =
    "story" in keyed ? storyApplyDoc : "epic" in keyed ? epicApplyDoc : projectApplyDoc;
  const result = schema.safeParse(raw);
  if (!result.success) {
    return { ok: false, message: formatZodError(result.error, "invalid apply doc") };
  }
  const duplicate = firstDuplicate(collectIds(result.data));
  if (duplicate) {
    return { ok: false, message: `duplicate id "${duplicate}"` };
  }
  return { ok: true, doc: result.data };
}

// Flatten the nested doc into the desired `Issue[]`, inferring `kind` from each
// `children:` entry's `kind` (or the root form key), `partOf` from the enclosing
// container, and `stackedOn` from a `kind: story` nested under another Story.
// Task and stacked-story `order` groups under a Story stay separate — YAML
// interleaving does not create one shared sequence. `blockedBy` is an
// Epic-level dep list, carried through verbatim on the Epic.
export function flattenApplyDoc(doc: ApplyDoc): DesiredIssue[] {
  const desired: DesiredIssue[] = [];

  const emitStory = (
    story: StoryNode | RootStoryNode,
    parentId: string,
    stackedOn: string | undefined,
    order?: number,
  ): void => {
    desired.push({
      id: story.id,
      kind: "story",
      title: story.title,
      partOf: parentId,
      ...(order !== undefined ? { order } : {}),
      ...(stackedOn ? { stackedOn } : {}),
      ...(story.description !== undefined
        ? { description: story.description }
        : {}),
    });
    // Separate order counters so tasks and stacked stories each renumber from 0
    // even when YAML interleaves them under one `children:` list.
    let taskOrder = 0;
    let stackedOrder = 0;
    forEachStoryChild(story.children, {
      task: (task) => {
        desired.push({
          id: task.id,
          kind: "task",
          title: task.title,
          partOf: story.id,
          order: taskOrder++,
          ...(task.description !== undefined
            ? { description: task.description }
            : {}),
        });
      },
      // A stacked story lives in the same container (Epic or Project) as its
      // fork point; only its `stackedOn` reflects the nesting under this story.
      // A `RootStoryNode` (story-rooted doc) only allows `kind: task` children,
      // so this branch is unreachable there.
      story: (nested) => {
        emitStory(nested, parentId, story.id, stackedOrder++);
      },
    });
  };

  const emitEpic = (
    epic: EpicNode | EpicChildNode,
    projectId: string,
    order?: number,
  ): void => {
    desired.push({
      id: epic.id,
      kind: "epic",
      title: epic.title,
      partOf: projectId,
      ...(order !== undefined ? { order } : {}),
      blockedBy: epic.blockedBy ?? [],
      ...(epic.description !== undefined
        ? { description: epic.description }
        : {}),
    });
    (epic.children ?? []).forEach((story, index) => {
      emitStory(story, epic.id, undefined, index);
    });
  };

  const emitIdea = (
    idea: IdeaChildNode,
    projectId: string,
    order: number,
  ): void => {
    desired.push({
      id: idea.id,
      kind: "idea",
      title: idea.title,
      partOf: projectId,
      order,
      ...(idea.description !== undefined
        ? { description: idea.description }
        : {}),
    });
  };

  // A story- or epic-rooted doc names its enclosing parent(s) by id only; the
  // parent issues already exist and are not part of the desired set. `stackedOn`
  // for a story-rooted story is intentionally omitted here and preserved from
  // disk by `apply` (a story doc never moves its fork point). With `epic`
  // omitted, the Story's `partOf` is the Project (project-level Story form).
  if (isStoryDoc(doc)) {
    emitStory(doc.story, doc.epic ?? doc.project, undefined);
    return desired;
  }
  if (isEpicDoc(doc)) {
    emitEpic(doc.epic, doc.project);
    return desired;
  }

  const project = doc.project;
  desired.push({
    id: project.id,
    kind: "project",
    title: project.title,
    ...(project.description !== undefined
      ? { description: project.description }
      : {}),
  });
  forEachProjectChild(project.children, {
    idea: (idea, index) => emitIdea(idea, project.id, index),
    story: (story, index) => emitStory(story, project.id, undefined, index),
    epic: (epic, index) => emitEpic(epic, project.id, index),
  });

  return desired;
}
