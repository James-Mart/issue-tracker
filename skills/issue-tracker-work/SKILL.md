---
name: issue-tracker-work
disable-model-invocation: true
description: >-
  Coordinate implementation of an Epic or project-level Story by spawning
  plugin subagents — do not implement yourself. Use when the user asks to
  implement or work a tracker Epic/Story, or load issue-tracker-work with
  `<epic-or-story-id>`.
---

# Issue Tracker — Work the Stack

Coordinate the implementation of one **work root** — an **Epic** or a
**project-level Story** — without doing the implementation yourself. You (the
agent invoked with the work root) are the **coordinator**. Your context is
precious: delegate all implementation, verification, review, model assignment,
and git to plugin subagents (`agents/*.md`).

The coordinator does no real reasoning — it reads tracker state, runs a thin set
of CLI commands, and spawns subagents in a fixed order — so it should itself run
on the cheap model, **Composer 2.5**, not a premium model (see **Models and
subagent roles**). The model discriminator assigns an implementor model onto
each Task; the implementor writes code, runs its own code review, records the
commit, and sets Task `status done`; the story-review agent records the Story
gate (`review`, `reviewedTasks`, optional remediation Tasks) without editing
workspace source, pauses the Story at `review` `awaiting-human` when a runtime
check needs a human, and when the branch is behind appends the
update-from-merge-base Task without changing stored `review`; the git
subagent owns branch create and Story finish.

**You do not write code, run the app, or verify the work yourself.** You read the
plan with `issue tree` and spawn subagents. Do **essentially no reasoning**:
every coordinator step below is a CLI invocation or a fixed linear action —
this skill is meant to be replaced by a deterministic script. Never set status
on a Story or Epic — Story/Epic status derives automatically (see SPEC.md).
Task `status` / `commits` writes are subagent-owned — see **Field
ownership**. Git and git-fact recording are delegated — see Rules. Task
`assignee` holds the implementor **family key** (or a legacy model slug).
Before each implementor spawn, **Resolve implementor family** (below) and
delegate `issue-tracker-implementor-<family>`; the pin comes from the role —
see **## Delegation**.

**Nomenclature:** **Task** / **Story** are issue-tracker kinds. **Work root**
means the Epic or project-level Story id this skill was invoked with — the
top-level unit Completion keys to. Delegation (app `delegate` /
IDE Cursor Task) is defined in **## Delegation**.

**Read** `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-cli.md`.

**Read** `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-ikigai.md`.

## Delegation

**Read** `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-delegation.md`.

**Read** `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-verification-store.md`.

## Argument

An **Epic** id or a **project-level Story** id (`partOf` the Project). If none
is given:

1. **Read** `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-resolve-project.md`
   and follow it. Never bare `issue list`.
2. Run `issue tree <projectId>` to list Epics and **project-level** Stories and
   ask which work root.

This skill works exactly one work root; to work several at once, start several
agents. There is no pick-up list — work starts only when the user chooses a
root. An Epic that is `blockedBy` another Epic cannot start until that blocker
is **fully merged** (all the blocker's Stories merged) — only start an Epic
once `issue epic get <rootId> blocked` prints `false`. (`blockedBy` is
Epic-only; a project-level Story has no such gate.) Because blockers clear at
a human-paced Epic boundary (a merge round-trip), this fits the one-root-at-a-
time model. Use the default `issues/` dir (do not set `ISSUES_DIR`) so the
human sees changes live in the UI.

## CLI checks

Run these commands in order (use `<rootId>` throughout):

1. `issue tree <rootId>`. This outline **is** your plan. For an **Epic**, it
   prints the Epic's Stories in **pure stacked depth-first** order over
   `stackedOn` alone — a Story stacked on another is nested under it, and root
   Stories (and same-level siblings) follow their stored order. For a
   **project-level Story**, it prints that Story, its Tasks, and any Stories
   stacked under it (same stacked depth-first order within the Project
   container). `blockedBy` is an Epic-level edge and plays **no part** in Story
   ordering (it only gates whether a whole Epic may start — see Argument).
   Under each Story its Tasks print in sequence. Every Story line carries chips;
   every Task line carries `status=` and, once done, `sha=`. **Chip legend
   (coordinator use):**
   - Walk order and Task sequence — top-to-bottom from this output; do not
     reorder by hand.
   - `mergeBase=<ref>` — derived git fork-point for the Story (Project
     `trunk`, a root Story/Epic `mergeBaseOverride`, or a parent branch — or
     `mergeBase=(unset)` when empty). Informational only; do not copy into git
     spawn stubs — the git agent reads `mergeBase` from
     `issue story get <storyId> mergeBase` (already layers override vs trunk).
   - `branch=<name>` — git branch name once recorded; do not copy into spawn
     stubs.
   - `branch=(unset)` — no git branch recorded yet; spawn start-branch (see
     Start a Story). Do **not** invent or substitute a branch name — not the
     Story id, not a guess from the title.
   - `plan not final` — the root's plan polish is not finished; stop per CLI
     checks step 5 rather than working Tasks.
   - `pr=`, `merged`, `blocked` — progress signals only; ignore for spawn
     *inputs*.
2. `issue summary <rootId>` — read `Project:` and `Workspace:`.
   **Read** `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-workspace-gate.md`
   and apply it using this summary output (before spawning anything — every
   repo-touching subagent would immediately escalate without a workspace).
3. Confirm the root kind from step 2 and bind `<rootKind>` (`epic` or `story`)
   for the rest of the run:
   - **Epic** — set `<rootKind>` = `epic`; proceed.
   - **Story** — confirm it is **project-level** (`issue story get <rootId> partOf`
     equals `<projectId>`; refuse Epic-child Stories — they are not work roots).
     Set `<rootKind>` = `story`.
   - Any other kind → refuse.
4. `issue list --in <projectId>` — read `problems`. If `problems` is
   non-empty, **stop and hand back to the user** — do not reason about or
   attempt fixes, and do not work a tree with integrity problems. (`list` /
   `tree` hide archived rows by default; pass `--show-archived` when you need
   them — see [SPEC.md](../../SPEC.md#archived-visibility).)
5. For both root kinds (`<rootKind>` `epic` or `story`): `issue get <rootId>
   planNotFinal` — if stdout is `true`, the root's plan is not final (its
   source Idea is still unarchived). **Stop and hand back to the user** rather
   than working any Task. What clears it: let the plan's polish finish, or
   archive the source Idea with `issue idea set <ideaId> archived true` (read
   `<ideaId>` from `issue get <rootId> sourceIdea`) — the same escape hatch
   the Cockpit's archive control performs. There is nothing stored on the root
   to change.
6. **Epic only** (`<rootKind>` = `epic`): `issue epic get <rootId> blocked` —
   if stdout is `true`, the Epic is `blockedBy` a blocker that has not fully
   merged, so — per Argument — it **cannot start**. Stop and hand back to the
   user rather than working any Task. Skip this check when `<rootKind>` is
   `story`.

## Setup

1. Mirror the Stories and their Tasks, in `issue tree` order, into your own
   todo list so you can track progress; keep exactly one Task `in_progress` at
   a time. This mirror is a cache of the outline — re-sync it from a fresh
   `issue tree <rootId>` each time control returns to you (see The loop).
2. Delegate the plugin roles below via the Spawn stubs. Pass **only** the
   delegate arguments each stub lists (`role`, `issueId`, `prompt`; plus
   `resumeId` when resuming). Never pass the workspace — each repo subagent
   resolves it from its own `issue summary` (SPEC § Project workspace). Do not
   gather descriptions, read diffs, or ingest reports into your own context.

### Resolve implementor family

Given a Task id: run `issue task get <taskId> assignee`. Trim stdout.

- Empty → raise
  `issue task set <taskId> needsAttention true --reason "no implementor model assigned"`
  and stop — do not spawn the implementor.
- `composer`, `grok`, or `opus` → that value is the family.
- Legacy model slug → map to family:
  - `composer-2.5` → `composer`
  - `cursor-grok-4.5-high-fast` → `grok`
  - `claude-opus-5-thinking-high` → `opus`
  - `claude-opus-4-8-thinking-high` → `opus`
- Anything else → raise
  `issue task set <taskId> needsAttention true --reason "unrecognized implementor assignee: <value>"`
  (substitute the unrecognized value) and stop. Never fall back to a default
  family.

Family → role:

| family | `role` |
|--------|--------|
| `composer` | `issue-tracker-implementor-composer` |
| `grok` | `issue-tracker-implementor-grok` |
| `opus` | `issue-tracker-implementor-opus` |

Delegate that family's role; the pin comes from the role frontmatter — see
**## Delegation**. Never pass a model slug from `assignee`. Never `view|head`,
never infer from discriminator chat or prior Tasks.

Because `issue tree` lists each Story after the Story it is stacked on,
walking the outline top-to-bottom always reaches a stacked Story only after its
parent's git branch and `done` tasks already exist: a stacked child's
dependency is satisfied — and it may proceed — once its parent's Tasks are all
`done` (it forks the parent's tip, so there is no merge gate).

## Models and subagent roles

Model pins come from each role's frontmatter (applied per **## Delegation**),
not from a spawn-time argument.

| Role | `role` | When | Model (role pin) | Mode |
|------|--------|------|------------------|------|
| Coordinator (you) | — | Drive the whole run: thin CLI + spawn subagents | Composer 2.5 (`composer-2.5`) | spawn/CLI only |
| Git | `issue-tracker-git` | Start a Story; finish a Story | `composer-2.5` | writes |
| Model discriminator | `issue-tracker-model-discriminator` | Before implement — assigns implementor model onto Task `assignee` | `composer-2.5` | writes (`issue task set … assignee` only) |
| Implementor | `issue-tracker-implementor-<family>` | Implement, review, and commit a Task | Role pin by family: `composer`→`composer-2.5`; `grok`→`cursor-grok-4.7-high-fast`; `opus`→`claude-opus-5-5-thinking-high` | writes (see Field ownership) |
| Story review | `issue-tracker-story-review` | Close-Story | `composer-2.5` | writes (`issue story set … review` / `reviewedTasks` / `needsAttention`; `issue story update-from-merge-base`; `issue story request-human`; `issue task add`; `issue story comment`) |
| Runtime validator | `issue-tracker-runtime-validator` | Spawned by Story review, not by you | `composer-2.5` | writes (`issue attach` on the Story) |

### Field ownership

Coordinator never sets Task `status` or Task `commits`.

| Field | Owner | When |
|-------|-------|------|
| Task `status` `in-progress` | Implementor | on implement entry |
| Task `status` `done` | Implementor | after its review, commit, and summary comment |
| Task `commits` | Git | spawned by the implementor |
| Story `review` | Story review | on each review round `passed` / `failed`; `awaiting-human` when it pauses for a human |
| Story `review` cleared from `awaiting-human` | Human | Done on the Story's request (`issue story human-done`) |
| Story `reviewedTasks` | Story review | all `done` Tasks inspected in that round |
| Story `needsAttention` (review three-strike) | Coordinator | on the 3rd counted story-review resume in one session — see **Close a Story** |

The implementor spawns its own code reviewers; per-Task review never reaches
you. Story review is the Story gate recorder: it sets `review` and
`reviewedTasks` and may append remediation Tasks or the update-from-merge-base
Task, or pause for a human (tracker writes only; never workspace source), and
it spawns the runtime validator itself; you spawn/resume it and enforce the
reopen cap (see **Close a Story**). Both keep findings out of your context via
comments / machine-readable fields.

## The loop

Walk the Stories in the order `issue tree` printed them (top-to-bottom). For
each Story: start it if needed, work its not-`done` Tasks in the sequence
`issue tree` lists them, then **Close a Story** (review gate +
finish-branch) before moving to Stories nested under it. A Story waiting on
a human is parked instead (see **Park a Story**).

**Re-read `issue tree <id>` every time control returns to you** — after
every subagent finishes and before you choose the next action — and re-sync your
todo list to it. The tree is the live plan, not a one-time snapshot: Stories or
Tasks can be injected into the in-progress work root mid-run (for example when
someone applies an epic- or story-rooted doc), and only a fresh `issue tree`
picks them up. Never act from a cached outline.

### Start a Story

If the Story tree chip shows `branch=(unset)`, spawn `issue-tracker-git` with
the start-branch stub before its first Task. When `branch=(unset)`, do **not**
invent or substitute a branch name — pass only the stub fields; the git agent
creates or resumes the Story branch (worktree + `branchName`).

### Per-Task cycle (for each Task, in sequence)

**Canonical** definition of the implementor spawn. Other sections only
cross-reference this. Status transitions during this cycle are owned by
subagents — see **Field ownership**. Do not set Task `status` or `commits`
yourself.

0. **Entry gate.** On every entry to this cycle for `<task>` (including skill
   re-run and Close-Story not-done), read via `issue task get` — in order —
   `needsAttention`, then `status`. First match wins; jump to that step and
   continue the numbered flow from there.
   - `needsAttention` is `true` → stop (Escalation).
   - `status` is `done` → step 3 (Advance).
   - otherwise → step 1.

   **Cold-restart limit.** A Task whose implementor is still in flight reads
   `in-progress`, so a skill re-run in that window falls through to step 1
   and may spawn a second implementor. Accept that window.

1. **Assign model.** Delegate `issue-tracker-model-discriminator` with the
   model-discriminator spawn stub. Wait until it finishes (or raises
   needsAttention). Do not read its result. Then step 2.

2. **Implementor.** Resolve implementor family for `<task>`, then delegate
   `issue-tracker-implementor-<family>` with the implement spawn stub. Wait
   until it finishes. Do not read its diff or ingest a report. Then read
   `issue task get <task> needsAttention`: `true` → stop (Escalation);
   otherwise step 3.

3. **Advance** to the next Task.

### Close a Story

Repeat until finish-branch or park:

1. **Re-sync.** Re-read `issue tree <id>` and re-sync your todo list.
2. **Not-done Tasks.** If any Task on the Story is not `done` (including a
   remediation Task Story review appended), **run** the full Per-Task cycle
   for each in tree order (entry gate + steps there). Then continue from
   step 1.
3. **Review gate.** Read `review` with
   `issue story get <storyId> review` and `reviewCurrent` with
   `issue story get <storyId> reviewCurrent` — never by parsing chat,
   `view`, or `tree`. For this Story in this coordinator session, keep how
   many resumes have counted and whether the previous story-review result
   set `review` to `failed`. Before any story-review return in this session,
   a stored `review` of `failed` is that previous result. Branch (first
   match wins):
   - `review` is `awaiting-human` → park the Story per **Park a Story** and
     leave Close a Story.
   - `reviewCurrent` is `true` → read
     `issue story get <storyId> needsAttention`. When it is `true`, stop
     (Escalation). When it is `false`, **Delegate**
     `issue-tracker-story-review` with the story-review spawn stub and wait
     until that run finishes. Then re-read `needsAttention`,
     `behindMergeBase` (`issue story get <storyId> behindMergeBase`),
     `reviewCurrent`, and
     `issue list task --in <storyId> --show-archived`. Record that this
     return did not set `review` to `failed`. Finish (step 5) when
     `behindMergeBase` is `false`, `reviewCurrent` is `true`,
     `needsAttention` is `false`, and that list's `issues` include no Task
     titled `Update from merge base` whose `status` is not `done`.
     Otherwise continue from step 1.
   - `review` unset → **Delegate** `issue-tracker-story-review` with the
     story-review spawn stub; keep the returned nested agent id as
     `resumeId`. Then step 4.
   - `review` set and `reviewCurrent` is `false` → this resume counts toward
     the session cap of three only when the previous story-review result set
     `review` to `failed`. A return that appended a Task titled
     `Update from merge base`, or stopped because one was already not
     `done`, did not set `review` to `failed`, so the later resume after
     that Task is `done` does not count, even when stored `review` is still
     `failed`. On the **3rd** counted resume, counting this one when it
     counts, run
     `issue story set <storyId> needsAttention true --reason "story-review: 3rd reopen in this session — <short summary>"`
     and stop (Escalation) — do **not** resume again. Otherwise **re-enter**
     that same story-review agent with the story-review resume stub and its
     `resumeId`. When the coordinator has lost the `resumeId` (skill
     re-run), look it up with `delegations` — the most recent entry in the
     returned `delegations` array whose `role` is
     `issue-tracker-story-review` — rather than starting a second
     story-review agent. Then step 4.
   Wait until a spawn or resume from the `review` unset branch or the stale
   `reviewCurrent` branch finishes (or raises needsAttention) before step 4.

4. **Gate after story-review.** Record whether this return set `review` to
   `failed`: it did only when `issue story get <storyId> review` is `failed`
   and `issue story get <storyId> behindMergeBase` is `false`. A failed
   `behindMergeBase` get did not set `review`. The next result that sets
   `review` to `failed` counts as usual. Then read
   `issue story get <storyId> needsAttention`. If `true`, stop (Escalation).
   When story-review returned from a **resume** round (`review` was already
   set before step 3 delegated) and `issue story get <storyId> retro` is
   `done`, run `issue story set <storyId> retro --clear` — the retro
   covered only the original Tasks. Then continue from step 1.

5. **Finish and advance.** All Tasks are `done` and `reviewCurrent` is
   `true` — do **not** run story-review again. Spawn `issue-tracker-git`
   with the finish-branch stub. Git applies the Story's effective merge
   policy — see SPEC § Project merge policy. Advance to the next Story.

### Park a Story

Close a Story parks a Story whose `review` is `awaiting-human`: Story review
has asked a human for something, and the human's Done clears `review`.

1. Add the Story to this session's parked list. Continue the walk at the
   next Story in `issue tree` order, skipping every Story nested under a
   parked Story.
2. Each time a Story finishes or parks, before starting the next Story,
   read `issue story get <storyId> review` for each parked Story. Remove
   each one whose `review` is no longer `awaiting-human` from the list and
   run Close a Story for it from step 1 before the next Story.
3. When every Story left to work is parked or nested under a parked Story,
   go to **## Completion**.

### Escalation

If a subagent is genuinely blocked (missing decision, ambiguous spec, external
dependency), have it raise `issue <kind> set <id> needsAttention true --reason "..."` on the issue
instead of guessing, and surface the block to the user rather than forcing
progress.

## Completion

When the Story walk ends, **Read**
`/root/.cursor/plugins/local/issue-tracker/skills/issue-tracker-work/references/completion.md`
and follow it.

## Spawn stubs

Pass each stub's delegate arguments (`role`, `issueId`, `prompt`; plus
`resumeId` when resuming). Inline the fields each stub lists.
Id labels in spawn prompts must be `Issue:` (or `Work root:` where noted) —
never kind nouns (`Task:`, `Story:`, `Commit:`, `Branch:`, `Epic:`). Children
own static behavior via their `agents/*.md` files — do not paste workflow
instructions here. Channel rules: **## Delegation** (do not re-Read the
include here).

**Issue context line** — shared prefix for discriminator, implement, and
story-review stubs:

> Work root: `<rootId>`. Issue: `<id>` (`<title>`).

Git stubs (`start-branch`, `finish-branch`): coordinator passes
**only** Mode + issue id — no work-root id, tree chips, or git facts
(`mergeBase`, `branchName`).

**Start branch** — `role: issue-tracker-git`, `issueId: <storyId>`

> Mode: start-branch. Issue: `<storyId>`.

**Finish branch** — `role: issue-tracker-git`, `issueId: <storyId>`

> Mode: finish-branch. Issue: `<storyId>`.

**Model discriminator** — `role: issue-tracker-model-discriminator`, `issueId: <id>`

> *(Issue context line.)*

**Implement** — `role: issue-tracker-implementor-<family>`, `issueId: <id>`

> *(Issue context line.)* Mode: implement.

**Story review** — `role: issue-tracker-story-review`, `issueId: <id>`
(when to spawn: Close-Story step 3)

> *(Issue context line.)*

**Story review (resume)** — `role: issue-tracker-story-review`, `issueId: <id>`
(when to resume: Close-Story step 3)

> *(Issue context line.)* Mode: resume.

## Rules

- Never implement, verify, or run the app yourself — always delegate. You own
  only coordination (thin CLI reads + spawn/resume). Field write scopes:
  **Field ownership**.
- Prefer `issue get` for scalar field reads — do not parse `view` /
  `summary` / `tree` for a single field (except `summary`'s `Workspace:`
  bootstrap line and `tree` chips for walk order).
- Never write Task `status` or Task `commits` yourself (Field ownership).
- Never run `git`/`gh` or the git-fact record commands (`issue story set …
  branchName` / `issue task add-commit` / `issue story set … prUrl` /
  `issue story set … merged`) yourself — spawn `issue-tracker-git` for Story
  start and Story finish only.
- Work one root, one Task at a time, in the Story order `issue tree` prints;
  finish a Story before the Stories stacked on it.
- Re-read `issue tree <id>` every time control returns to you and re-sync
  your todo list, so Stories or Tasks injected into the in-progress work root
  mid-run are picked up. Never act from a cached outline.
- Per-Task entry gate and implementor spawn: see **Per-Task cycle** — single
  canonical definition. Story-review spawn/resume and reopen cap: see
  **Close a Story** — single canonical definition. Story-review remediation is
  Close-Story's job, through remediation Tasks.
- Never let a validator edit workspace source (write scopes: Models table).
- Never set status on a Story or Epic. Do not decide whether to open or merge a
  PR — that is the Story's effective `mergePolicy`, applied by
  `issue-tracker-git` on finish-branch. Always spawn finish-branch; never read
  or branch on the policy.
- Act only through the CLI for tracker writes; never hand-edit `issue.json`.
- Workspace is a subagent concern, not yours (SPEC § Project workspace): you never
  resolve or pass it — each repo-touching subagent and the model discriminator
  read it from their own `issue summary` (discriminator: read-only peek only; see
  SPEC § Model discriminator (read-only peek)). Your only workspace duty is the
  CLI checks step 2: if the work root's Project has no `Workspace:`
  line, stop and hand back to the user instead of spawning.
