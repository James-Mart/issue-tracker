# Plan body

Not a spawnable agent (no frontmatter). Cross-cutting plan-body rules.
Callers **Read** this file from disk — a markdown link alone is not enough.

Absolute path for this file (Read this exact path):

`/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-plan-body.md`

## Describe the work

Plan prose states work context, outcomes it lands, and seams and contracts it
builds or must honor. Out-of-scope lists and plan invariants are omitted.

## Compression target

A plan is a **lossy compression** of the design conversation behind it. It
keeps the **shape**, the **critical seams**, the **main dependencies**, and the
**critical contracts**; nuance within those bounds is settled during
implementation. The target fails in two directions:

- **Too much** — detail neither the shape nor a critical contract needs:
  construction steps, file layout, procedure, how to test.
- **Too little** — a gap that would make the implementor invent architecture:
  a missing seam, dependency, or contract.

Each Story and Task states the outcomes it lands. The work loop checks the
work against those outcomes; the implementor chooses how to verify them.

### Examples

**Too much** — a Task in a payments service:

> In `src/billing/refunds.ts`, add a `computeRemainder` helper, call it from
> `RefundController.create`, add cases to `refunds.test.ts`, and run the
> suite. Verify: refunding a partial capture returns the remainder.

Compressed:

> A refund on a partially captured charge returns at most the captured
> amount. Seam: `refund(chargeId, amountCents?) -> { refundId, amountCents,
> status }`; omitting `amountCents` refunds everything captured.

**Too little** — a Task in a notes app:

> Notes can be edited offline.

Compressed:

> Notes edit offline and sync on reconnect. The server wins conflicts: the
> client queues `{ noteId, body, baseVersion }`, and a stale `baseVersion` gets
> `409` with the current note, which replaces the local edit.

## Work root shape

Every work root (Epic or project-level Story) opens with `# Background`
(current state and what is wrong), then `# Proposal` (one or a few sentences
on the improvement). Project-level Stories continue with approach and
contracts after those sections.

## Epic contracts

Epic body may add cross-cutting contracts more than one child Story builds
against, as concrete shape (names, fields, behavior).

## Plan prose

- **No em-dashes.** Plan prose contains no em-dash characters.
- **Vocabulary.** Prose uses the names the Project's own readers already use
  for its areas and operations. Tracker vocabulary (work loop, polish, story
  review) appears only when the Project being planned is the tracker.
- **Names and paths.** Prose names no file paths. A name internal to a module
  appears only when the shape or a critical contract needs it.
- **Seams.** A Task that introduces or wires an interface gives an example
  function shape and field names. The implementor may deviate when
  implementation forces it.
- **One answer on important choices.** Every choice about shape, seams,
  dependencies, or contracts has one definitive answer. Detail deliberately
  left to implementation is not an open choice.

## Grain: Story vs Task

- **Project** — the top-level container that groups related Epics, Ideas, and
  project-level Stories. Organizational only (no status); its `description.md`
  is a short overview of the whole product area.
- **Epic** — work root per [Work root shape](#work-root-shape); may add
  [Epic contracts](#epic-contracts). When to choose an Epic versus a
  project-level Story is **Epic grain** in
  `/root/.cursor/plugins/local/issue-tracker/skills/issue-tracker-authoring/SKILL.md`.
- **Story** = one shippable unit: scope, approach, and the data-model or
  interface contracts specific to it. May be `partOf` an Epic or the Project
  (project-level Story). A project-level Story is a work root
  ([Work root shape](#work-root-shape)). Normally several Tasks; one Task's
  worth of work is a Task, not a Story. No Story or Task is title-only. No
  Story holds just one Task, and the Story count is not merely the bullet
  count. Phrase how the Story lands per **Merge-policy delivery prose** in
  `/root/.cursor/plugins/local/issue-tracker/skills/issue-tracker-authoring/SKILL.md`.
- **Task** = one git commit: the outcome it lands, plus the seams and contracts
  it introduces ([Compression target](#compression-target)). Must be a vertical
  slice — a standalone, buildable, testable cut of one capability
  (`/root/.cursor/plugins/local/issue-tracker/SPEC.md#kinds`). Tree nesting
  supplies context, so a link from task to epic is unnecessary. **Tasks run
  in the order they appear in the doc** (top-to-bottom); array position is
  implementation order. Authors leave `order` unset.

**Each Story must be independently mergeable into its derived `mergeBase`.**
Stories merge into their merge base (stacked children after their fork-point
Story, in stack order), and only Stories merge — Tasks are internal steps that
ship together as one Story. Keep one cohesive change in a single Story as
multiple Tasks so merging one Story leaves the merge base buildable (a schema
change and the code that consumes it stay together). See the stacked merge
model in
`/root/.cursor/plugins/local/issue-tracker/SPEC.md#the-stacked-pr-merge-model`.
To target an existing non-trunk branch, set a merge-base override after
`apply` (**Merge-base override** in
`/root/.cursor/plugins/local/issue-tracker/skills/issue-tracker-authoring/SKILL.md`).

### Task shape: vertical slices, not horizontal layers

Normative rule:
`/root/.cursor/plugins/local/issue-tracker/SPEC.md#kinds`
(Task kind + stacked merge model).

**Prefer** vertical slices — one thin end-to-end cut of one capability.

Horizontal layering that does not stand alone fails that rule:

- **Bad:** Task 1 adds types or interfaces only; Task 2 wires them up, or a
  half-migration Task that does not compile. Early Tasks do not prove anything
  on their own.
- **Good:** Task 1 lands one thin end-to-end cut; Task 2 adds the next
  capability the same way.

A plan's *phases* are the Story grain, its *todos/steps* the Task grain. Group
related todos into one Story and land them as tasks; when mapping todos to
Tasks, reshape horizontal layering into vertical slices (split or merge until
each Task stands alone as above). Split only a genuinely oversized phase. One
todo to one Story (a stack of one-task Stories with an empty Task tier) means
the split is at the wrong tier.
