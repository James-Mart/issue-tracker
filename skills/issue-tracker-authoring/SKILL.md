---
name: issue-tracker-authoring
disable-model-invocation: true
description: >-
  Author an issue-tracker plan tree compressed to shape, seams, dependencies,
  and contracts as one nested YAML doc and `apply` it (or `issue story append`
  Tasks onto an existing Story).
---

# Issue Tracker — Author a Plan Tree

Authoring the tracker is producing a **plan artifact**, so it is permitted in
**Plan mode** (the tree is the plan). The tree is the **design of record** — it
replaces any prior plan doc and stands alone. Companion material belongs
**with the issue that uses it** (prose in `description.md`, or opaque files as
attachments — [SPEC.md § Attachments](../../SPEC.md#attachments)). Do not
hand-edit `issue.json`. Glossary and apply-doc shape: [SPEC.md](../../SPEC.md).
Work the resulting tree with `issue-tracker-work`. **Read**
`/root/.cursor/plugins/local/issue-tracker/skills/issue-tracker-work/SKILL.md`
and follow it.
**Read** `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-cli.md`.

**Read**
`/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-plan-body.md`
and follow it.

Localize prose to the tier where it belongs. Put each unit's prose on that
unit, and leave the enumeration of children to the child list
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
  two parallel Stories at once (fan-in that a single fork point can't express),
  linearize it as a stack: stack one of those Stories on the other, then the
  dependent unit on top
  ([SPEC.md § Fan-in](../../SPEC.md#fan-in-why-a-multi-parent-dependency-becomes-a-stack)).
- **Re-apply as the plan evolves.** `apply` is an idempotent upsert that
  prunes-by-default: nodes you add appear, nodes you drop from the doc are
  deleted, and unchanged nodes are untouched. Omitting `blockedBy` on a
  restated Epic clears it to `[]` (full desired state) — it does not preserve
  on-disk edges. It is atomic (a doc that would break integrity changes
  nothing) and preserves runtime/progress fields and attachment bytes, so
  re-applying an edited doc mid-implementation is safe
  ([SPEC.md § Declarative/imperative field seam](../../SPEC.md#declarativeimperative-field-seam)).
  Re-`apply` the doc for plan-owned changes; do not patch plan-owned fields
  incrementally with `issue <kind> add` or kind `set`. Reconciling a newer
  outline version into a linked root edits in place instead (see
  [Source outline (sourceOutline)](#source-outline-sourceoutline)).
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

A decomposition lands exactly **one** work root. Choose it by shape, not
habit. A reconciliation mints no root: it edits the linked roots in place and
appends Tasks to their open Stories (see
[Source outline (sourceOutline)](#source-outline-sourceoutline)).

- **Project-level Story** (`partOf` the Project, no Epic) — the plan is a
  **single Story plus its Tasks**. Author with Project `children:`
  `kind: story`, or story-form apply (`project:` + `story:`, no `epic:`).
- **Epic** — you need **sibling root Stories**, **stacking**, or Epic
  **`blockedBy`**. The body opens with `# Background` and `# Proposal`, and
  may add Epic contracts (plan body include).

Stacking under a Project is integrity-legal (same-container rule), but
**authoring prefers an Epic whenever any stacking exists** — soft policy, not
an integrity error. Polish may warn on a lone single-Story Epic (suggest a
project-level Story) and on a project-level stack (suggest wrapping in an
Epic). Do not invent Story-level `blockedBy`; promote to an Epic when you need
cross-unit deps.

## Task footprint

- Anything introduced purely to make an intermediate Task verifiable —
  placeholder specs, fixtures, stubs, temporary wiring — must name the Task
  that removes it.
- A Task that mutates state outside the repository (`/etc` entries, `sudo`,
  global installs, machine-wide config) must justify in its prose why no
  design avoids the mutation.

## Prior-content consistency

When a Task Change updates content, you must update every place that still
describes or depends on the prior version of that content so it stays
consistent with the new version.

## Merge-policy delivery prose

Phrase delivery and merge language in issue prose according to the Story's
effective `mergePolicy` ([SPEC.md § Project merge policy](../../SPEC.md#project-merge-policy);
read with `issue story get <storyId> mergePolicy`):

- **`pull-request`** — PR phrasing is correct ("in the PR", "open a PR", etc.).
- **`manual`** — finish by pushing the Story branch and stopping; a human opens
  and merges the PR later. Do not say the work merges to trunk.
- **`merge`** — no pull request exists at Story finish. Do not write "in the
  PR" or other pull-request-assuming language; phrase in terms of merging or
  delivery (e.g. "merge to trunk", "land the Story").
- **`fast-forward`** — integrate with ff-only onto the derived mergeBase. Do
  not write pull-request-assuming language. Do not describe a merge commit.

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

## Source idea (sourceIdea)

When an Idea's plan lands as a new root, including a root decomposed from an
outline whose `sourceIdea` names that Idea, record that edge **after** `apply`
(imperative only — not in the YAML doc):

- Epic: `issue epic set <id> sourceIdea <ideaId>`
- Project-level root Story: `issue story set <id> sourceIdea <ideaId>`

`apply` and `issue story append` preserve `sourceIdea` and never read it from
description prose or YAML. Only Idea-sourced migrations set this — replans
from an Epic or Story record nothing. Rules:
[SPEC.md § Relationships](../../SPEC.md#relationships).

## Source outline (sourceOutline)

A root decomposed from an outline version covers that version. Each Epic and
Story describes the slice of the outline it implements and links to the
outline sections it builds on instead of quoting them, naming the section in
the link text: `[<section heading>](issue:<outlineId>)`.

Stamp that version on every item `apply` created (each id on its stdout
`created:` line: the root, each Story, and each Task) **after** `apply`
(imperative only — not in the YAML doc):

`issue <kind> set <id> sourceOutline '{"outline":"<outlineId>","version":<n>}'`

The stamp is metadata; prose never restates the version. Rules:
[SPEC.md § Relationships](../../SPEC.md#relationships).

An Epic is open while `issue epic get <id> epicStatus` is not `done`. A
Story is open while `issue story get <id> merged` is `false`. A Task is
open while `issue task get <id> status` is not `done`.

### Reconciler

The reconciler rewrites each open Epic and Story description in scope so
it matches Version. Scope is the root and every Story under it, or that
Story and its root when the prompt names a Story. It creates no Stories
or Tasks. It skips any Story whose `needsAttention` is true.

- Set each rewritten description with
  `issue <kind> set <id> description --file <path>`, following the linking
  rule above.
- Stamp Version on each issue this run rewrote and on that issue's open
  Tasks:
  `issue <kind> set <id> sourceOutline '{"outline":"<outlineId>","version":<n>}'`
  Stamp the root, and its open Tasks, only when every open Story under it
  has `issue story get <id> behind` printing `false`. A Story this run
  skipped stays behind until a later run stamps it. Stamp the prompt's
  Version, including when the outline's latest body is newer.

### Decomposer reconcile

Reconciling a newer version `<n>` into an open root stamped with that
outline edits the root in place.

- Set each rewritten open Epic or Story description with
  `issue <kind> set <id> description --file <path>`, following the linking
  rule above.
- Land new Tasks on an open Story with `issue story append`.
- Stamp `<n>` on each Task `issue story append` created and on each open
  Epic and Story in the root whose `sourceOutline` names this outline.
  Existing Tasks and merged Stories keep their stamps.

## Tasks with no diff (noDiff)

Some Tasks' work produces no source-controlled diff: tracker-state edits,
measurements later Tasks depend on, human-only operations, end-to-end proofs.
Such a Task states its outcome and any result later Tasks need, like any other
Task. Set the flag after the Task lands (imperative only — not in the YAML
doc):

- New root: after successful `apply`
- Appended Tasks: after successful `issue story append`, on each created Task
  id

`issue task set <taskId> noDiff true`

`apply` and `issue story append` never write `noDiff`; they preserve an
existing value. Rules:
[SPEC.md § Derived terms](../../SPEC.md#derived-terms).

## Promoted mockup artifacts

Outline decompose attaches captures in its post-apply step.

When the reconcile summary lists a held capture, reconcile follows
**Held captures** in
`/root/.cursor/plugins/local/issue-tracker/skills/issue-tracker-plan/references/migrate.md`.

When a procedure names this section, **Read**
`/root/.cursor/plugins/local/issue-tracker/skills/issue-tracker-plan/references/migrate.md`
and follow **Chosen PNG archives**.

## Completeness pass

Before done:

- **Plan body** — rules in
  `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-plan-body.md`
  hold across the tree.
- Companion material follows [SPEC.md § Attachments](../../SPEC.md#attachments).
- **Epic grain** — single-Story plans use a project-level Story; Epics are for
  sibling roots, stacking, or `blockedBy` (see
  [Epic grain](#epic-grain-project-level-story-vs-epic)).
- **One root** — the plan is one Epic or project-level Story, with fan-in
  linearized as stacks (see
  [Epic grain](#epic-grain-project-level-story-vs-epic) and
  [Author declaratively](#author-declaratively-one-yaml-doc-then-apply)).
- **Parent/child prose boundaries** — follow the localize guidance above
  ([SPEC.md](../../SPEC.md#parent-prose-must-not-restate-descendant-lists)):
  Epic holds no phase- or task-level detail that belongs in children; no
  Project/Epic/Story restates its children's per-unit list.
- Every piece of verifiable scaffolding names the Task that removes it (see
  [Task footprint](#task-footprint)).
- Every Task that mutates state outside the repository justifies in its prose
  why no design avoids the mutation (see [Task footprint](#task-footprint)).
- Every Task Change that updates content also updates every place that still
  describes or depends on the prior version (see
  [Prior-content consistency](#prior-content-consistency)).
- Delivery/merge phrasing matches the Story's effective `mergePolicy` (see
  [Merge-policy delivery prose](#merge-policy-delivery-prose)).
- Non-trunk bases use imperative `mergeBase` on the root Story or Epic after
  `apply` (see [Merge-base override](#merge-base-override)) — never invent a
  base in YAML or Task prose for the git agent.
- Idea-sourced migrations record `sourceIdea` imperatively after `apply`
  (see [Source idea (sourceIdea)](#source-idea-sourceidea))
  — never put the field in the YAML doc or a `Source idea:` description line.
- Outline decompositions stamp `sourceOutline` on every created item after
  `apply`. Reconciler and decomposer reconcile follow
  [Source outline (sourceOutline)](#source-outline-sourceoutline). Each Epic
  and Story links to the outline sections it builds on.
- Every Task with no diff uses imperative `noDiff` after `apply` or
  `issue story append` (see
  [Tasks with no diff (noDiff)](#tasks-with-no-diff-nodiff)) — never put the
  flag in the YAML doc.
- Outside decompose and reconcile, chosen mockup directions follow
  **Promoted mockup artifacts** after `apply` — not in the YAML doc.
