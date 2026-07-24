---
name: issue-tracker-authoring
disable-model-invocation: true
description: >-
  Author a standalone issue-tracker plan tree as one nested YAML doc and
  `apply` it. Use when planning a stack of git PRs, deciding Epic/Story/Task
  grain, splitting captures into multiple roots, or turning a plan into
  tracked issues.
---

# Issue Tracker — Author a Plan Tree

Authoring the tracker is producing a **plan artifact**, so it is permitted in
**Plan mode** (the tree is the plan). The tree is the **entire design** — it
must replace any prior plan doc and stand alone. Companion material belongs
**with the issue that uses it** (prose in `description.md`, or opaque files as
attachments — [SPEC.md § Attachments](../../SPEC.md#attachments)). Do not
hand-edit `issue.json`. Glossary and apply-doc shape: [SPEC.md](../../SPEC.md).
Work the resulting tree with `issue-tracker-work`.
**Read** `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-cli.md`.

Localize prose to the tier where it belongs — don't dump the whole spec in the
Epic and leave children title-only, and don't enumerate in a parent the specific
work its children each cover
([SPEC.md](../../SPEC.md#parent-prose-must-not-restate-descendant-lists)).

## Author declaratively: one YAML doc, then `apply`

Write the **whole tree as a single nested YAML doc** and `apply` it — do not
build it up with imperative `issue <kind> add` calls and hand-threaded ids.

```bash
issue apply plan.yaml
```

Doc format and field seam: [SPEC.md § `apply` doc format](../../SPEC.md#apply-doc-format).

- **Structure: `children:` + `kind` only.** Every nest uses `children:`; every
  entry declares `kind`. Allow-lists: Project → `epic | idea | story`; Epic →
  `story`; Story → `task | story`. Under a Story, `kind: story` is a stacked
  Story (`stackedOn` that Story; `partOf` the same Epic or Project as the fork
  point). Root nodes omit `kind` (form key implies it). `partOf` and
  `stackedOn` are inferred from nesting, never written by hand. Legacy nest
  keys (`stories:` / `tasks:` / `stacked:`) are not accepted.
- **Ids are author-chosen and stable.** Every node carries a required kebab `id`
  you pick (unique, slug-safe, title-independent). Because you choose them up
  front you can author `issue:<id>` cross-links and Epic-level `blockedBy` ids
  before anything exists — no create-order dependency, no id capture.
- **`blockedBy` is the only explicit cross-reference, and it lives on the
  Epic.** Containment (`partOf`) and the fork point (`stackedOn`) come from
  nesting; `blockedBy` is an **Epic-level** list of other same-Project Epic ids —
  the sole edge that crosses an Epic boundary. Model dependencies *within* an
  Epic as **stacks** (`stackedOn`), not `blockedBy`. When a unit needs code from
  two parallel Stories at once (a multi-parent / cross-stack dependency that a
  single fork point can't express), don't reach for a Story-level edge: split it
  into a **separate Epic that is `blockedBy` the first**, keeping Epics small
  (see the diamond in SPEC.md — keeps parallel stories parallel instead of
  linearizing them, at the cost of waiting for the blocking Epic to merge).
- **Re-apply as the plan evolves.** `apply` is an idempotent upsert that
  prunes-by-default: nodes you add appear, nodes you drop from the doc are
  deleted, and unchanged nodes are untouched. Omitting `blockedBy` on a
  restated Epic clears it to `[]` (full desired state) — it does not preserve
  on-disk edges. It is atomic (a doc that would break integrity changes
  nothing) and preserves runtime/progress fields and attachment bytes, so
  re-applying an edited doc mid-implementation is safe
  ([SPEC.md § Declarative/imperative field seam](../../SPEC.md#declarativeimperative-field-seam)).
  Re-`apply` the doc for plan-owned changes; do not patch plan-owned fields
  incrementally with `issue <kind> add` or kind `set`.
- **Scope the doc to a subtree.** Prune-by-default is bounded to the doc's root.
  To edit one epic or story without touching its siblings, root the doc there
  and reference the enclosing parents by id: an **epic form** (`project: <id>`
  string + `epic:` object) reconciles just that epic within the project, and a
  **story form** (`project: <id>` string + `story:` object; include `epic: <id>`
  only when the Story is under an Epic) reconciles that story and its
  `kind: task` children. Omit `epic` for a project-level Story (`partOf` the
  Project). Epic/story forms leave Ideas untouched (Ideas are Project children
  only). A story doc owns only its own tasks (`kind: story` children are
  refused there — stacked Stories belong to the Story's container apply scope)
  and preserves the story's fork point.

## Epic grain: project-level Story vs Epic

Choose the top-level work root by shape, not habit:

- **Project-level Story** (`partOf` the Project, no Epic) — the plan is a
  **single Story plus its Tasks**. Author with Project `children:`
  `kind: story`, or story-form apply (`project:` + `story:`, no `epic:`).
- **Epic** — you need **sibling root Stories**, **stacking**, or Epic
  **`blockedBy`**. Overview + cross-cutting invariants only (not the full
  spec).

Stacking under a Project is integrity-legal (same-container rule), but
**authoring prefers an Epic whenever any stacking exists** — soft policy, not
an integrity error. Polish may warn on a lone single-Story Epic (suggest a
project-level Story) and on a project-level stack (suggest wrapping in an
Epic). Do not invent Story-level `blockedBy`; promote to an Epic when you need
cross-unit deps.

## Multi-Epic split

When one capture might be more than one top-level root, split into multiple
roots (sibling Epics and/or project-level Stories) when either applies:

- **(a) Diamond / cross-stack dependency** — requires a new Epic with
  `blockedBy` (mechanism:
  [Author declaratively](#author-declaratively-one-yaml-doc-then-apply);
  [SPEC.md § The diamond](../../SPEC.md#the-diamond-why-a-multi-parent-dependency-becomes-a-new-epic)).
- **(b) Independent topics** — themes are independent under the Project
  vision, not facets of one super-feature (each theme becomes its own root;
  choose Epic vs project-level Story per root by Epic grain above).

Keep themes that are facets of one super-feature under a **single** root
Epic (or one project-level Story when grain allows). **Size alone is not a
signal** to split.

For each resulting root, still choose Epic vs project-level Story by
[Epic grain](#epic-grain-project-level-story-vs-epic) above.

## Grain: Story vs Task

- **Project** — the top-level container that groups related Epics, Ideas, and
  project-level Stories. Organizational only (no status); its `description.md`
  is a short overview of the whole product area.
- **Epic** — overview + cross-cutting design principles/invariants only
  (what governs every phase). Not the full spec. When to choose an Epic vs a
  project-level Story: see
  [Epic grain](#epic-grain-project-level-story-vs-epic).
- **Story** = one shippable unit: scope, approach, and any data-model or
  interface detail specific to it. May be `partOf` an Epic or the Project
  (project-level Story). Normally several tasks; one task's worth of work is a
  Task, not a Story. Phrase how the Story lands per
  [Merge-policy delivery prose](#merge-policy-delivery-prose).
- **Task** = one git commit: implementor-resolution detail (what to do + how to
  verify), no deeper than a good plan section. Must be a standalone vertical
  slice that leaves the tip buildable/testable ([SPEC.md](../../SPEC.md#kinds)).
  Any Task with implementor work ends with a markdown `### Verify` or
  `## Verify` heading — not inline `Verify:` / `**Verify:**` (see
  [Task Verify heading](#task-verify-heading)). Tree nesting supplies context,
  so linking task → epic is unnecessary. **Tasks run in the order they appear
  in the doc** (top-to-bottom); authors never specify `order` — array position
  is implementation order.

**Each Story must be independently mergeable into its derived `mergeBase`.**
Stories merge into their merge base (stacked children after their fork-point
Story, in stack order), and only Stories merge — Tasks are internal steps that
ship together as one Story. So never split one cohesive change across Stories
such that merging one leaves the merge base broken (e.g. a schema change in one
Story and the code that consumes it in another): keep it in a single Story as
multiple Tasks. See the stacked merge model in
[SPEC.md](../../SPEC.md#the-stacked-pr-merge-model). To target an existing
non-trunk branch, set a merge-base override after `apply` (see
[Merge-base override](#merge-base-override)).

### Task shape: vertical slices, not horizontal layers

Normative rule lives in [SPEC.md](../../SPEC.md#kinds) (Task kind + stacked
merge model): each Task must leave the Story tip **buildable and testable**.

**Prefer** vertical slices — one thin end-to-end cut of a capability (types +
implementation + a focused test) that stands alone.

**Avoid** horizontal layering that does not stand alone:

- **Bad:** Task 1 adds types/interfaces only; Task 2 "wires them up"; Task 3
  adds tests — or a half-migration Task that does not compile. Early Tasks do
  not prove anything on their own.
- **Good:** Task 1 adds one complete capability (types, implementation, and a
  focused test) that builds; Task 2 adds the next capability the same way.

A plan's *phases* are the Story grain, its *todos/steps* the Task grain. Group
related todos into one Story and land them as tasks; when mapping todos to
Tasks, reshape horizontal layering into vertical slices (split or merge until
each Task stands alone as above). Split only a genuinely oversized phase. One
todo → one Story (a stack of one-task Stories with an empty Task tier) means
you split at the wrong tier.

## Task interface seams

Task descriptions that introduce or wire an interface must spell out **API
shape and field names** (function names/signatures, HTTP paths/methods,
multipart field name) so implementors do not invent them. Do not require file
or middleware homes — those are implementor choices, not authoring seams.

- **Bad:** "Add HTTP download for attachments" (implementor invents
  `getAttachment`, multer, and multipart field `"file"`).
- **Good:** "Add `GET /attachments/:id` returning the raw bytes; upload is
  `POST /attachments` multipart field `attachment`."

## Task Change paths

When a Task Change **does** name a file path, that path MUST be relative to
the Project `workspace` root.

- **Bad:** `In /root/.cursor/plugins/local/issue-tracker/app/cli.ts` (absolute
  path)
- **Good:** `In app/cli.ts`

## Task Verify heading

Any Task with implementor work (a `### Change` section or equivalent
implementable scope) must end with a markdown `### Verify` or `## Verify`
heading that states how to check the work. Do not use inline `Verify:` or
`**Verify:**` labels — plan-authoring-conformance flags those as missing
Verify.

- **Bad:** `Verify: run tests` or `**Verify:** read the file and confirm X`.
- **Good:**

```markdown
### Verify

Run the unit tests. Confirm X.
```

## Prior-content consistency

When a Task Change updates content, you must update every place that still
describes or depends on the prior version of that content so it stays
consistent with the new version.

## Merge-policy delivery prose

Phrase delivery and merge language in issue prose according to the Story's
effective `mergePolicy` ([SPEC.md § Project merge policy](../../SPEC.md#project-merge-policy);
read with `issue story get <storyId> mergePolicy`):

- **`pull-request`** — PR phrasing is correct ("in the PR", "open a PR", etc.).
- **`merge`** or **`manual`** — no pull request exists at Story finish. Do not
  write "in the PR" or other pull-request-assuming language; phrase in terms of
  merging or delivery instead (e.g. "merge to trunk", "land the Story").

## Merge-base override

To build on an existing non-trunk branch, set an explicit merge-base **after**
`apply` (imperative only — not in the YAML doc):

- Project-level root Story: `issue story set <id> mergeBase <branch>`
- Epic: `issue epic set <id> mergeBase <branch>` — every first-layer Story
  inherits that base; those Stories cannot set their own override
- Stacked Stories always derive from the parent Story's branch — unchanged

Derived `mergeBase` (`issue story get … mergeBase`) already reflects the
override. Rules:
[SPEC.md § The stacked-PR merge model](../../SPEC.md#the-stacked-pr-merge-model).

## Completeness pass

Before done:

- Every part of the source design is represented.
- Companion material follows [SPEC.md § Attachments](../../SPEC.md#attachments)
  (no external workspace paths).
- **Epic grain** — single-Story plans use a project-level Story; Epics are for
  sibling roots, stacking, or `blockedBy` (see
  [Epic grain](#epic-grain-project-level-story-vs-epic)).
- **Multi-Epic split** — decide single root vs multiple top-level roots by
  diamond/`blockedBy` and independent-topics criteria; size alone does not
  force a split (see [Multi-Epic split](#multi-epic-split)).
- No Story/Task is title-only; no Story holds just one task and the
  Story count isn't merely the bullet count.
- **Parent/child prose boundaries** — follow the localize guidance above
  ([SPEC.md](../../SPEC.md#parent-prose-must-not-restate-descendant-lists)):
  Epic holds no phase- or task-level detail that belongs in children; no
  Project/Epic/Story restates its children's per-unit list.
- Every Task that introduces or wires an interface spells out API shape and
  field names (see [Task interface seams](#task-interface-seams)).
- Every Task Change that names file paths uses workspace-relative paths (see
  [Task Change paths](#task-change-paths)).
- Every Task with implementor work has a `### Verify` / `## Verify` heading
  (not inline `Verify:`) stating how to check the work (see
  [Task Verify heading](#task-verify-heading)).
- Every Task Change that updates content also updates every place that still
  describes or depends on the prior version (see
  [Prior-content consistency](#prior-content-consistency)).
- Delivery/merge phrasing matches the Story's effective `mergePolicy` (see
  [Merge-policy delivery prose](#merge-policy-delivery-prose)).
- Non-trunk bases use imperative `mergeBase` on the root Story or Epic after
  `apply` (see [Merge-base override](#merge-base-override)) — never invent a
  base in YAML or Task prose for the git agent.
