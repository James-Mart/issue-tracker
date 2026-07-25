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
on the cheap model, **Composer 2.5 (`composer-2.5`)**, not a premium model. The
model discriminator assigns an implementor model onto each Task; the
implementor writes code; the code-quality validator owns Task `qa` (writes the
gate, resumes across rounds, three-strike escalate); the spec-conformance
validator records the Story gate (`specReview`, optional remediation Task)
without editing workspace source; the git subagent owns branch create, Task
finalize, and Story finish.

**You do not write code, run the app, or verify the work yourself.** You read the
plan with `issue tree` and spawn subagents. Do **essentially no reasoning**:
every coordinator step below is a CLI invocation or a fixed linear action —
this skill is meant to be replaced by a deterministic script. Never set status
on a Story or Epic — Story/Epic status derives automatically (see SPEC.md).
Task `status` / `qa` and work-root `retro` writes are subagent-owned — see
**Field ownership**. Git and git-fact recording are delegated — see Rules. Task
`assignee` holds the implementor **family key** (or a legacy model slug).
Before each implementor spawn, **Resolve implementor family** (below) and spawn
`issue-tracker-implementor-<family>` with that wrapper's pin as Cursor Task
`model`, subject to **## Model availability**.

**Nomenclature:** **Task** / **Story** are issue-tracker kinds. **Cursor Task**
is the subagent spawn/resume tool (`model`, `prompt`, `subagent_type`, resume).
**Work root** means the Epic or project-level Story id this skill was invoked
with — the top-level unit Completion and retro key to.

**Read** `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-cli.md`.

## Model availability

**Read** `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-model-availability.md`.

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

## Preflight: confirm before starting

Before doing anything else, stop and ask the user to confirm they want you to
coordinate this work root now. State that **Composer 2.5 (`composer-2.5`) is the
recommended coordinator**. Do not attempt to detect or print the current model
id. If they do not confirm, stop — do not start coordinating. After they
confirm, continue with the CLI checks below.

### CLI checks

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
   - `pr=`, `merged`, `blocked` — progress signals only; ignore for spawn
     *inputs*. Exception: Completion’s retro gate (below) reads `merged` chips
     to decide whether to spawn retro — that is not a spawn-input.
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
4. `issue <rootKind> set <rootId> retro --clear` — always run after user
   confirm. Clears any prior plan-time `retro done` so Completion retro can
   run for this work invocation. Re-invoking work after a finished work retro
   will clear and may re-spawn retro.
5. `issue list <projectId>` — read `problems`. If `problems` is
   non-empty, **stop and hand back to the user** — do not reason about or
   attempt fixes, and do not work a tree with integrity problems. (`list` /
   `tree` hide archived rows by default; pass `--show-archived` when you need
   them — see [SPEC.md](../../SPEC.md#archived-visibility).)
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
2. Spawn via Cursor Task `subagent_type` for the plugin agents below. Pass
   **only** the fields each spawn stub lists (see Spawn stubs). Never pass the
   workspace — each repo subagent resolves it from its own `issue summary`
   (SPEC § Project workspace). Do not gather descriptions, read diffs, or ingest
   reports into your own context.

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

Family → wrapper pin (Cursor Task `model`):

| family | `subagent_type` | `model` |
|--------|-----------------|--------|
| `composer` | `issue-tracker-implementor-composer` | `composer-2.5` |
| `grok` | `issue-tracker-implementor-grok` | `cursor-grok-4.5-high-fast` |
| `opus` | `issue-tracker-implementor-opus` | `claude-opus-5-thinking-high` |

Never pass a model slug from `assignee` as Cursor Task `model` — always the
wrapper pin for the resolved family, subject to **## Model availability**.
Never `view|head`, never infer from discriminator chat or prior Tasks.

Because `issue tree` lists each Story after the Story it is stacked on,
walking the outline top-to-bottom always reaches a stacked Story only after its
parent's git branch and `done` tasks already exist: a stacked child's
dependency is satisfied — and it may proceed — once its parent's Tasks are all
`done` (it forks the parent's tip, so there is no merge gate).

## Models and subagent roles

| Role | `subagent_type` | When | Model | Mode |
|------|-----------------|------|-------|------|
| Coordinator (you) | — | Drive the whole run: thin CLI + spawn subagents | Composer 2.5 (`composer-2.5`) | spawn/CLI only; Preflight `retro --clear` (Field ownership) |
| Git | `issue-tracker-git` | Start a Story; finish a Task after `qa=passed`; finish a Story | `composer-2.5` | writes |
| Model discriminator | `issue-tracker-model-discriminator` | Before implement — assigns implementor model onto Task `assignee` | `composer-2.5` | writes (`issue task set … assignee` only) |
| Implementor | `issue-tracker-implementor-<family>` | Implement a Task; per-task revise via Cursor Task **resume** | That family's wrapper pin (Resolve implementor family) | writes (see Field ownership) |
| Code-quality validator | `issue-tracker-code-quality-validator` | Per-Task cycle steps 3–4 (canonical spawn/resume on `qa`) | `composer-2.5` | writes (`issue task set … qa` / `needsAttention`; `issue task comment`) |
| Spec-conformance validator | `issue-tracker-spec-conformance-validator` | Close-Story when Story `specReview` is unset | `composer-2.5` | writes (`issue story set … specReview` / `issue task add` / `issue story|task comment`) |
| Retro | `issue-tracker-retro` | Completion when every Story in the walk is `merged` and work-root `retro` is unset | `cursor-grok-4.5-high-fast` | writes (`issue <rootKind> comment` on source / `issue idea add` / `issue idea set` labels / `issue idea attach` / `issue <rootKind> set … retro` / `issue <rootKind> set … needsAttention`) |

### Field ownership

Coordinator never sets Task `status`, Task `qa`, or work-root `retro`
`in-progress` / `done`. Its sole work-root `retro` mutation is Preflight
`--clear` (CLI check step 4).

| Field | Owner | When |
|-------|-------|------|
| Task `status` `in-progress` | Implementor | on first implement entry |
| Task `status` `fixing` | Implementor | on every revise entry |
| Task `status` `done` | Git (finish-commit) | Task finalize |
| Task `qa` | Code-quality | on each entry `reviewing`, then terminal `passed` / `changes-requested` (three-strike → `needsAttention`); never the coordinator |
| Work-root `retro` (clear) | Coordinator | at Preflight after user confirm (`issue <rootKind> set <rootId> retro --clear`) |
| Work-root `retro` `in-progress` | Retro | after transcript resolution succeeds (`issue <rootKind> set <rootId> retro`) |
| Work-root `retro` `done` | Retro | after successful terminal comment |

Implement and revise are the **same** implementor agent. Code-quality is a
**writer** of Task `qa` (spawn/resume and three-strike escalate: see **Per-Task
cycle** — you do **not** count rounds). Spec-conformance is the Story gate
recorder: it sets `specReview` and may append a remediation Task (tracker
writes only; never workspace source). Both keep findings out of your context
via comments / machine-readable fields.

## The loop

Walk the Stories in the order `issue tree` printed them (top-to-bottom). For
each Story: start it if needed, work its not-`done` Tasks in the sequence
`issue tree` lists them, then **Close a Story** (specReview gate +
finish-branch) before moving to Stories nested under it.

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
creates and records the git branch.

### Per-Task cycle (for each Task, in sequence)

**Canonical** definition of implementor / code-quality spawn and resume.
Other sections only cross-reference this. Status transitions during this cycle
are owned by subagents — see **Field ownership**. Do not set Task `status` or
`qa` yourself. Do not count QA rounds.

0. **Entry gate.** On every entry to this cycle for `<task>` (including skill
   re-run and Close-Story not-done), read via `issue task get` — in order —
   `needsAttention`, then `qa`. First match wins; jump to that step and
   continue the numbered flow from there. Do **not** re-run this gate
   mid-cycle (after a subagent returns, follow the step that sent you there).
   - `needsAttention` is `true` → stop (Escalation).
   - `qa` is `passed` → step 5 (Finalize).
   - `qa` is `reviewing` → step 3 (resume code-quality; stuck mid-review).
   - `qa` is `changes-requested` → step 2b (revise; do not Mode `implement`).
   - otherwise (`qa` unset) → step 1.

   **Cold-restart limits** (no separate phase field — do not invent one here).
   Task `status` is set on implementor *entry* (`in-progress` / `fixing`),
   not on exit, so it is **not** a completion signal and must not be used to
   infer “implementor finished.” Disk alone cannot uniquely recover these
   windows; prefer staying in-cycle (agent ids + step flow) when possible:
   - `qa` unset while implementor may still be in flight → falls through to
     step 1 (may re-spawn Mode `implement`). Accept that window rather than
     treating `in-progress`/`fixing` as “ready for QA.”
   - `qa=changes-requested` is identical for mid-revise and post-revise
     awaiting code-quality → entry gate always takes step 2b. In-cycle
     re-review (step 2 → step 3) is unaffected; a skill re-run in the
     post-revise window may run an extra revise before code-quality.

1. **Assign model.** Spawn `issue-tracker-model-discriminator` with the
   model-discriminator spawn stub. Wait until it finishes (or raises
   needsAttention). Do not read its result. Then step 2a.

2. **Implementor (spawn or resume).** Resolve implementor family for `<task>`.
   Remember the Cursor Task agent id whenever you spawn so later revises can
   resume. Wait for finished or blocked (needsAttention on `<id>`). Do not
   read its diff or ingest a report. When the implementor finishes, go to
   step 3 (including after revise — that is how in-cycle re-review runs).
   - **2a. Spawn (implement).** Spawn `issue-tracker-implementor-<family>` with
     Cursor Task `model` set to that family's wrapper pin and the implement
     spawn stub. Fresh path only (from step 1).
   - **2b. Resume (revise).** Resume the remembered implementor agent with the
     revise stub (same family wrapper and pin). If no agent id is available
     (skill re-run), **spawn** with the revise stub (Mode `revise`) — never
     Mode `implement` when entering from `qa=changes-requested`.

3. **Validate (code quality).** Read `issue task get <task> qa`. Branch on
   the value (do not count QA rounds yourself):
   - unset → **spawn** `issue-tracker-code-quality-validator` with the
     code-quality spawn stub; remember its Cursor Task agent id.
   - `changes-requested` or `reviewing` → **resume** that same code-quality
     Cursor Task with the code-quality resume stub (`reviewing` means a prior
     entry did not reach a terminal qa — resume, do not spawn a second agent).
     If no agent id is available (skill re-run), **spawn** with the
     code-quality resume stub instead.
   - `passed` → skip to step 5 (Finalize); do not spawn or resume
     code-quality again.
   Wait until a spawn/resume finishes (or raises needsAttention) before
   step 4.

4. **Gate after code-quality.** Read both
   `issue task get <task> needsAttention` and `issue task get <task> qa`
   (in that order). Branch:
   - `needsAttention` is `true` → stop (Escalation). Check this **before**
     `qa`, because three-strike leaves terminal `qa=changes-requested` **and**
     `needsAttention` — do not resume the implementor in that case.
   - `qa` is `passed` → step 5.
   - `qa` is `changes-requested` and `needsAttention` is `false` →
     step 2b (revise), which then continues at step 3.

5. **Finalize.** Spawn `issue-tracker-git` with the finish-commit stub.

6. **Advance** to the next Task.

### Close a Story

Repeat until finish-branch:

1. **Re-sync.** Re-read `issue tree <id>` and re-sync your todo list.
2. **Not-done Tasks.** If any Task on the Story is not `done` (including a
   validator-injected remediation Task), **run** the full Per-Task cycle
   for each in tree order (entry gate + steps there). Then continue from
   step 1.
3. **`specReview` gate.** Read `specReview` with
   `issue story get <storyId> specReview` — never by parsing chat or `view`.
   If unset, spawn `issue-tracker-spec-conformance-validator` with the
   spec-conformance spawn stub. Wait until it finishes (or raises
   needsAttention); do not ingest
   its report. Then continue from step 1.
4. **Finish and advance.** All Tasks are `done` and `specReview` is set
   (`passed` or `failed`) — do **not** run the validator again. Spawn
   `issue-tracker-git` with the finish-branch stub. Git applies the Story's
   effective merge policy — see SPEC § Project merge policy. Advance to the next Story.

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

Pass these as the Cursor Task `prompt`. Inline the fields each stub lists.
Id labels in spawn prompts must be `Issue:` (or `Work root:` where noted) —
never kind nouns (`Task:`, `Story:`, `Commit:`, `Branch:`, `Epic:`). Children
own static behavior via their `agents/*.md` files — do not paste workflow
instructions here.

Model literals below are pins — see **## Model availability** before passing
one.

**Issue context line** — shared prefix for discriminator, implement,
code-quality, spec-conformance, and revise stubs:

> Work root: `<rootId>`. Issue: `<id>` (`<title>`).

Git stubs (`start-branch`, `finish-commit`, `finish-branch`): coordinator passes
**only** Mode + issue id — no work-root id, tree chips, or git facts
(`mergeBase`, `branchName`).

**Start branch** — `subagent_type: issue-tracker-git`
(`model: composer-2.5`)

> Mode: start-branch. Issue: `<storyId>`.

**Finish commit** — `subagent_type: issue-tracker-git`
(`model: composer-2.5`)

> Mode: finish-commit. Issue: `<taskId>`.

**Finish branch** — `subagent_type: issue-tracker-git`
(`model: composer-2.5`)

> Mode: finish-branch. Issue: `<storyId>`.

**Model discriminator** — `subagent_type: issue-tracker-model-discriminator`
(`model: composer-2.5`)

> *(Issue context line.)*

**Implement** — `subagent_type: issue-tracker-implementor-<family>`
(Cursor Task `model` = that family's wrapper pin)

> *(Issue context line.)* Mode: implement. Comment role:
> `implementor`.

**Code-quality validator** — `subagent_type: issue-tracker-code-quality-validator`
(`model: composer-2.5`; when to spawn vs resume: Per-Task cycle step 3)

> *(Issue context line.)* Mode: review. Comment role:
> `code-quality-validator`.

**Code-quality validator (resume)** — `subagent_type: issue-tracker-code-quality-validator`
(`model: composer-2.5`; when to resume: Per-Task cycle step 3)

> *(Issue context line.)* Mode: resume. Comment role:
> `code-quality-validator`. Verify that previously requested changes were
> fixed.

**Spec-conformance validator** — `subagent_type: issue-tracker-spec-conformance-validator`
(`model: composer-2.5`)

> *(Issue context line.)* Comment role:
> `spec-conformance-validator`.

**Revise** — `subagent_type: issue-tracker-implementor-<family>`
(Cursor Task `model` = that family's wrapper pin; resume when an agent id is
available, else spawn)

> *(Issue context line.)* Mode: revise. Comment role:
> `implementor`.

**Retro** — `subagent_type: issue-tracker-retro`
(`model: cursor-grok-4.5-high-fast`)

> Work root: `<rootId>` (`<title>`). Comment role: `retro`.

## Rules

- Never implement, verify, or run the app yourself — always delegate. You own
  only coordination (thin CLI reads + spawn/resume). Field write scopes:
  **Field ownership**.
- Prefer `issue <kind> get` for scalar field reads — do not parse `view` /
  `summary` / `tree` for a single field (except `summary`'s `Workspace:`
  bootstrap line and `tree` chips for walk order).
- Never write Task `status`, Task `qa`, or work-root `retro` (`in-progress` /
  `done`) yourself. Preflight `retro --clear` only (Field ownership).
- Never run `git`/`gh` or the git-fact record commands (`issue story set …
  branchName` / `issue task set … commitSha` / `issue story set … prUrl` /
  `issue story set … merged`) yourself — spawn `issue-tracker-git` for Story
  start, Task finalize, and Story finish only. Git sets Task `status` `done`
  on finish-commit; implementor owns `in-progress` / `fixing`.
- Work one root, one Task at a time, in the Story order `issue tree` prints;
  finish a Story before the Stories stacked on it.
- Re-read `issue tree <id>` every time control returns to you and re-sync
  your todo list, so Stories or Tasks injected into the in-progress work root
  mid-run are picked up. Never act from a cached outline.
- The implementor leaves work uncommitted; the **git** subagent finalizes per
  its Finish Commit matrix (the authority for these outcomes): a normal Task
  is committed (message = Task title) and recorded `done` with its sha, while
  a Task the implementor deliberately marked `noDiff` (no source-controlled
  changes) is recorded `done` with **no** git commit and no sha — do not treat
  that as "nothing was done" when a non-source-controlled file was edited.
  Either way the coordinator just spawns finish-commit — it never inspects the
  tree or the `noDiff` flag, and an empty tree alone is never a completion
  signal.
- Per-Task QA loop (entry gate, spawn/resume, three-strike): see **Per-Task
  cycle** — single canonical definition; you never count QA rounds.
  Spec-conformance remediation is Close-Story's job (see that section) — no
  story-level revise.
- Never let a validator edit workspace source (write scopes: Models table).
  Code-quality may write Task `qa` / `needsAttention` and comments only.
- Never set status on a Story or Epic. Do not decide whether to open or merge a
  PR — that is the Story's effective `mergePolicy`, applied by
  `issue-tracker-git` on finish-branch. Always spawn finish-branch; never read
  or branch on the policy.
- Act only through the CLI for tracker writes; never hand-edit `issue.json`.
- Workspace is a subagent concern, not yours (SPEC § Project workspace): you never
  resolve or pass it — each repo-touching subagent and the model discriminator
  read it from their own `issue summary` (discriminator: read-only peek only; see
  SPEC § Model discriminator (read-only peek)). Your only workspace duty is the
  Preflight CLI checks step 2: if the work root's Project has no `Workspace:`
  line, stop and hand back to the user instead of spawning.
