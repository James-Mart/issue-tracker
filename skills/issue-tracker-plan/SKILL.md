---
name: issue-tracker-plan
disable-model-invocation: true
description: >-
  Grill an Idea, todo Epic, or not-started project-level Story into a plan
  tree via apply, then auto-chain polish and retro. Use when the user asks
  to plan an Idea, flesh out a tracker plan, or run issue-tracker-plan.
---

# Issue Tracker — Plan (grill → plan tree)

Turn a rough capture into one or more detailed plan trees — each a
**project-level Story > Task** tree or an **Epic > Story > Task** tree, per
authoring Epic grain and [Multi-Epic split](../issue-tracker-authoring/SKILL.md#multi-epic-split).
You grill the user, show the outline, get one explicit-consequence yes, then
migrate via `issue apply` (issue-tracker-authoring), auto-chain
`issue-tracker-plan-polish` on every resulting root, then spawn
`issue-tracker-retro` per root after polish succeeds. Behavioral contract:
Epic **auto-plan-polish-confirm** invariants (single post-outline gate +
auto-chain polish) — do not restate that list here. Do not implement product
code; this skill only authors the plan artifact.

**Read** `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-cli.md`.

Grain, multi-Epic split, apply doc shape, parent-prose, and prune-by-default
rules live in issue-tracker-authoring and [SPEC.md](../../SPEC.md) — when
proposing the tree(s), apply those rules yourself; only ask the user when a
product or dependency choice remains after those rules. Do not restate them
here. Reference authoring [Multi-Epic split](../issue-tracker-authoring/SKILL.md#multi-epic-split)
for when one capture becomes multiple roots; do not duplicate that rule text.

## Argument

An **Idea** id, an **Epic** id whose derived
`issue epic get <id> epicStatus` is `todo`, or a **project-level Story** id
whose derived `issue story get <id> storyStatus` is `not-started`.

If none is given:

1. **Read** `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-resolve-project.md`
   and follow it. Never bare `issue list`.
2. Run `issue tree <projectId>`. Offer only **Ideas**, Epics whose status
   chip is `todo` (or confirm with `issue epic get <id> epicStatus`), and
   **project-level** Stories whose status chip is `not-started` (or confirm
   with `issue story get <id> storyStatus`; project-level = `partOf` is the
   Project). **Do not offer** `in-progress` / `done` Epics, or Stories at
   `in-progress` / `pr-open` / `merged` — they fail §Bootstrap gates.

## Bootstrap

Before grilling:

1. `issue summary <id>` — confirm kind; read `Project:` and `Workspace:`.
   **Read** `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-workspace-gate.md`
   and apply it using this summary output (codebase lookup during the grill
   needs cwd = `Workspace:`).
2. **Read** `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-consult-supporting-doc.md`,
   then consult `vision` per that file using the step-1 summary output.
3. Kind / status gates:
   - **Idea** — proceed.
   - **Epic** — run `issue epic get <id> epicStatus`.
     - `todo` → proceed.
     - `in-progress` or `done` → **refuse** and stop. Tell the user this skill
       only rewrites pre-implementation Epics; for an existing tree use
       `issue-tracker-plan-polish` (or work it with `issue-tracker-work`).
   - **Story** — confirm it is **project-level** (`issue story get <id> partOf`
     equals `<projectId>` from step 1; refuse Epic-child Stories). Then run
     `issue story get <id> storyStatus`.
     - `not-started` → proceed.
     - `in-progress`, `pr-open`, or `merged` → **refuse** and stop. Tell the
       user this skill only rewrites not-started project-level Stories; for an
       existing tree use `issue-tracker-plan-polish` (or work it with
       `issue-tracker-work`).
   - Any other kind → refuse.
4. `issue <kind> view <id>` — load the full capture (`description.md`), not
   only the summary blurb (`idea`, `epic`, or `story` from step 3).
5. If the source is an **Epic** or **project-level Story**, also
   `issue tree <id>` so the existing subtree is in context before grilling.

## Grill-me protocol (inline)

Interview the user relentlessly about every aspect of the plan until you reach
a **shared understanding**. Walk down each branch of the design tree, resolving
dependencies between decisions one-by-one. For each question, provide your
recommended answer.

Do **not** ask the user to choose Story vs Task grain, Epic vs project-level
Story grain, or slice decomposition — apply issue-tracker-authoring grain
yourself. Reserve questions for product and dependency choices that remain
after those rules.

Keep asking one question at a time — do **not** dump a Story/Task outline
mid-grill.

**Rules (mandatory):**

- Ask **one question at a time**, waiting for feedback before continuing.
  Multiple questions at once is bewildering.
- Each question should be **succinct**.
- Recommended answers must **not** be part of the question text. Express them
  only via a `(recommended)` prefix in the **list of answers** (not inside the
  question).
- When a **focused** codebase question or fact needs answering (cwd =
  Project `Workspace:`), **delegate** research rather than reading widely
  yourself — spawn **Focused codebase research** (Spawn stubs); wait for its
  summary, then continue the grill.
- Product and dependency decisions remain the **stakeholder's** — the user who
  launched the planner and controls the vision — including questions that impact
  **user or developer experience** (UX/DX). When unsure about any of these, do
  not resolve product direction yourself; put each decision to them and wait.
- **Do not enact** the plan (no `apply`, no tracker writes that materialize the
  tree) until the user answers yes at the single post-outline gate below.
- Do **not** ask a separate pre-outline “shared understanding?” confirm —
  when the grill is ready, go straight to the outline + gate.

This protocol is **inlined here**. Do **not** add or invoke a separate
plugin-local grill-me skill.

## Single post-outline gate, then migrate

When the grill is ready (no extra pre-outline confirm):

1. **Outline.** Show the proposed tree outline in chat with enough prose that
   the user can judge scope. Match the chosen migrate shape(s):
   - **Single root** — story-form → root Story title + Task titles; epic-form →
     Epic title + Story/Task hierarchy (implementation order).
   - **Multi-root** — list every resulting root (Epic or project-level Story),
     each with its Story/Task hierarchy and any `blockedBy` edges.
   Do **not** `apply` yet. The user may edit the outline in chat before
   answering the gate.
2. **One gate.** Ask **one** yes/no whose lead-in states that **yes** means:
   migrate the plan, run `issue-tracker-plan-polish` on every resulting root,
   auto-apply polish fixes, and spawn `issue-tracker-retro` per root after
   polish succeeds. No other confirm beats before migrate.
3. On **yes** → **Migrate** (below). On **no** → stop (do not migrate).

## Migrate

On **yes** at the single post-outline gate, **Read**
`/root/.cursor/plugins/local/issue-tracker/skills/issue-tracker-plan/references/migrate.md`
and follow it. Then continue at **## After success**.

## After success

For each resulting root in `blockedBy` order when deps exist among Epic
roots (otherwise any order) — **serially**: finish that root's polish and
retro before starting the next; never parallelize polish across roots (each
polish spawns parallel check agents; concurrent polish runs overload CPU):

1. Auto-chain **`issue-tracker-plan-polish`** on that root — no polish
   yes/no. Polish itself auto-applies when safe (see that skill); do not add
   an approve-before-apply beat here. If polish is deferred in this session
   (e.g. the user asks to grill more before polish runs), the polish→retro
   obligation for that root persists — deferral does not reset or cancel it.
2. After that root's polish finishes its **success path** — retained apply
   landed, no-changes-needed (including after the user resolves an escalate
   and apply proceeds), or **planner-vetoed** polish (leftover findings
   listed in the polish summary with an explicit veto) — always spawn
   **Retro** (Spawn stubs) for
   that root. Do **not** check whether work-root `retro` is unset before
   spawning. Wait until the Cursor Task finishes (or raises needsAttention)
   — do not fire-and-forget. Do **not** mine transcripts yourself, and do
   **not** expect or relay a retro summary into your context.

**Standalone polish.** **Standalone** polish is `issue-tracker-plan-polish`
invoked on its own, not as a continuation of an in-flight
`issue-tracker-plan` migrate in the same session. Polish deferred within a
plan session and run later in that same session is **not** standalone — after
its success path, still spawn retro as in step 2. Truly standalone,
user-initiated polish does **not** spawn retro.

## Spawn stubs

Pass these as the Cursor Task `prompt`. Inline the fields each stub lists.
Children own static behavior via their `agents/*.md` files — do not paste
workflow instructions here.

**Focused codebase research** — `subagent_type: generalPurpose`
(`model: composer-2.5`)

> Research: `<focused question>`. Workspace: `<absolute workspace path>`.
> Seed paths (if any): `<paths>`. Return a concise factual summary only.

**Retro** — `subagent_type: issue-tracker-retro`
(`model: cursor-grok-4.5-high-fast`)

> Work root: `<rootId>` (`<title>`). Comment role: `retro`.

## Rules

- Tracker writes for the migration happen only after yes at the single
  post-outline gate.
- Do not edit workspace product source as part of planning (plan artifact /
  grill research reads only).
- Do not auto-start `issue-tracker-work`. After a successful migrate, always
  auto-chain polish then retro as in **After success** (no second yes/no).
