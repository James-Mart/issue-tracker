---
name: issue-tracker-plan
disable-model-invocation: true
description: Grill an Idea or an outline session and save the outline.
---

# Issue Tracker — Plan (grill → outline)

Turn a rough capture into an outline in the Project catalog. You grill the
user, check which affected screens get a mockup round, run those rounds, save
the outline, and conclude the Idea. Conclude records the code-gate verdict,
archives the Idea, and starts a decomposer when the Idea's gates say so. A
planner session on an outline answers
a context question from the current version, or saves a revision as the next
version without starting reconciliation. A new planning session on an outline
grills from the brief in its opening message, saves each later version the
same way, and does not conclude. A stop before the outline is saved leaves
its current version unchanged. Do not implement product code; this
skill only authors the plan artifact.

A retro on the planning session is available on demand through
[issue-tracker-retro](../issue-tracker-retro/SKILL.md); run one only when
asked.

**Read** `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-cli.md`.

**Read** `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-ikigai.md`.

## Argument

An **Idea** id, or an **Outline** id for a planner session on that outline.

If none is given:

1. **Read** `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-resolve-project.md`
   and follow it. Never bare `issue list`.
2. Run `issue tree <projectId>`. Offer only **Ideas**.

## Bootstrap

Before grilling:

1. `issue summary <id>` — confirm kind; read `Project:` and `Workspace:`.
   **Read** `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-workspace-gate.md`
   and apply it using this summary output (codebase lookup during the grill
   needs cwd = `Workspace:`).
2. **Read** `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-consult-supporting-doc.md`,
   then consult `codingStandards` per that file using the step-1 summary output
   (to avoid locking a plan direction the standards forbid — not for
   implementation detail in Task prose).
3. Kind gate — **Outline** → **## Outline session** and stop. **Idea** → steps 4–7. Any other kind → refuse.
4. `issue view <id>` — load the full capture (`description.md`).
5. `issue project get <projectId> trunk` — Project trunk (`<projectId>` from
   step 1).
6. `issue idea get <id> mergeBase` — printed branch → merge-base answer
   for **Merge-base first**; empty output → settle in **Merge-base first**.

## Outline session

When Bootstrap's kind gate landed here, this section is the whole session.
An Idea follows **## Grill-me protocol**.

The session's opening message chooses the path. An opening message that
carries a `Brief:` line is a **New planning session**. Every other outline
session is the **Continued planner**.

### New planning session

Grill from that brief, then save the outline. This session does not run
`issue idea conclude`.

1. `issue outline view <outlineId>` prints the latest body. The opening
   message's `Version` is the version the brief was written against. Its
   `Execution gate`, `Code approval required`, `Merge base`, `Merge policy`,
   and `Out of band` are the outline's plan settings. `unset` means that
   setting is not stored. Leave the settings as they are.
2. Grill the brief against that body. Follow **## Grill-me protocol** for
   the questions. The merge base is the opening message's value, so
   **Merge-base first** is already settled: when it names a branch other
   than the Project trunk, pass that branch as `Ref` on focused research;
   when it is the trunk or `unset`, omit `Ref`. Read the trunk with
   `issue project get <projectId> trunk` (`<projectId>` from Bootstrap
   step 1). When the grill is ready, save the next version in step 3.
3. Save the next version the way **Continued planner** saves a revision.
   That save is this session's outline write. Stopping before it leaves
   the current version unchanged. The message that reports the save names
   `<outlineId>` and the version from `issue outline get <outlineId> version`.
4. After that save, a later message follows **Continued planner**.

### Continued planner

`issue outline view <outlineId>` prints the latest body.

A message that asks for the outline text to change is a revision. Any other
message is context.

**Context.** Answer from the latest body. The saved version stays the current one.

**Revision.**

1. **Write the next body.** **Read**
   `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-publishing-voice.md`
   and follow it. Revise the latest body so the change is folded into the
   `##` sections it belongs to, keeping the outline shape from **## Conclude**
   step 1.
2. **Save it.** `issue outline set <outlineId> description --file <path>`.
   That save is the next version and does not start reconciliation. The final
   message reports `<outlineId>` and the version from `issue outline get
   <outlineId> version`.

## Grill-me protocol (inline)

Interview the user relentlessly about every aspect of the plan until you reach
a **shared understanding**. Walk down each branch of the design tree, resolving
dependencies between decisions one-by-one. For each question, provide your
recommended answer.

Do **not** ask the user to choose Story vs Task grain, Epic vs project-level
Story grain, or slice decomposition — the decomposer slices the outline.
Reserve questions for product and dependency choices.

Keep asking one question at a time — do **not** show the outline mid-grill.

**Rules (mandatory):**

- **Merge-base first** — settle which git
  ref the plan is built on before any other grill question. Bootstrap
  step 6 — printed branch → that branch
  is the answer. Empty output → ask **one** question about which git ref
  the plan should be built on. That question recommends the Project
  **trunk** from Bootstrap step 5 via `(recommended)` in the answer list.
  An answer equal to that trunk is **trunk**; any other answer is a
  **non-trunk branch**. **Trunk** — proceed with the rest of the grill;
  Focused codebase research uses the workspace working tree only (omit
  `Ref` in spawn stubs). Carry the answer and the merge policy (when
  non-trunk) through to **## Conclude**.
  - **Non-trunk branch** — ask **one** merge-policy question for the
    resulting root (Epic or project-level Story) next. Recommend
    **`pull-request`** via `(recommended)` in the answer list. Valid values:
    `pull-request`, `merge`, `manual`, `fast-forward`
    ([SPEC.md § Project merge policy](../../SPEC.md#project-merge-policy)).
  - **Non-trunk branch** — for every **Focused codebase research** spawn
    during the rest of the grill, pass the merge-base answer as `Ref` so
    research reads at that ref (see Spawn stubs).
- After the merge-base answer and before
  any other grill question, spawn one
  **Focused codebase research** (Spawn stubs; `role: issue-tracker-research`)
  whose `Research` surveys how the host repository already solves directory
  placement and what a directory's location means, test registration and
  invocation, how binaries and toolchains are located, and how dependencies
  get installed. Wait for its summary; findings stay in session and inform
  the grill.
- Ask **one question at a time**, waiting for feedback before continuing.
  Multiple questions at once is bewildering.
- Each question should be **succinct**.
- Recommended answers must **not** be part of the question text. Express them
  only via a `(recommended)` prefix in the **list of answers** (not inside the
  question).
- When a further **focused** codebase question or fact needs answering (cwd =
  bootstrap `Workspace:`), **delegate** research rather than reading widely
  yourself — spawn **Focused codebase research** (Spawn stubs); wait for its
  summary, then continue the grill.
- Product and dependency decisions remain the **stakeholder's** — including
  questions that impact **user or developer experience** (UX/DX). When unsure
  about any of these, do not resolve product direction yourself; put each
  decision to them and wait.
- **Mock-or-skip check** — judge whether the plan will create or change UI.
  When it will, ask this check once you believe the product seams are
  closed, before any mockup round. It is **one** question that names every
  affected **screen** as **mock** or **skip**, each with a one-line reason —
  the unit is the screen: changes that land together on one screen are one
  entry. Mark a screen skip only when every change on it is small; mark
  every other screen mock. A change is small when every part of it is
  copy-only, layout-preserving, or reuses an existing pattern as-is. A new
  screen, a new layout, a new interaction, or a new pattern is not small.
  The answer list carries each answer's consequence:
  - **Start** — run a mockup round for each mock screen, one screen at a
    time, then go to the outline. For each, **Read**
    `/root/.cursor/plugins/local/issue-tracker/skills/issue-tracker-mockup/SKILL.md`
    and follow it, naming that screen and passing the issue being planned as
    its argument. What you do with what a round returns is
    **## What a round returns** below. With no mock screen, go straight to
    the outline.
  - **Keep grilling** — resume the grill, and ask this check again the next
    time you believe the seams are closed.
  - **Amend** — the reply moves named screens between mock and skip. Treat
    it as **Start** on the amended list, without asking the check again. A
    screen the reply does not name stays as the check proposed it.
- **Do not enact** the plan (no tracker writes that materialize work)
  until **## Conclude** runs `issue idea conclude`, or a **New planning session** saves the next
  outline version.
- Do **not** ask a separate pre-outline “shared understanding?” confirm.
  When the grill is ready, an Idea goes to **## Conclude** and a **New
  planning session** goes to its save.

This protocol is **inlined here**. Do **not** add or invoke a separate
plugin-local grill-me skill.

## What a round returns

A round posts its captures and then waits on you. Conformance is judged
inside the round, so the stakeholder judges only whether the direction lets
the vision flourish — no question you ask sends them to the `designSystem`
doc.

- **Mockup feedback** — take the mockup round's Feedback step with the
  redirection. That step resumes `issue-tracker-mockup-author` with the
  redirection as its feedback and leaves `issue-tracker-design-conformance`
  idle.

- **Conformant return** — post it, then ask **one** question about
  vision-level fit: whether this direction serves the product the plan is
  for. Put your own small tweaks for the direction in that same message.
  The answer takes one of two branches:
  - **Satisfied, or asks only for small changes** — small as the
    **Mock-or-skip check** defines it. The answer accepts the direction with
    your tweaks and any it adds. Take that direction id to the round's
    acceptance beat, and in the message that posts the acceptance, say the
    direction is accepted with those tweaks. Ask no further yes/no.
  - **Asks for a change that is not small, or for another direction** — that
    request and your own tweaks are the redirection. Take **Mockup feedback**.
    Neither the direction nor those tweaks are accepted. It never starts a
    second round for that screen.
- **Held tweak wording** — hold the wording of every accepted tweak, yours
  and the stakeholder's, with its direction id through to the outline.
- **Escalated return** — post the captures together with the violations the
  round named, labelled as failing conformance. Then ask **one** question
  whose three answers each carry their consequence in the answer list:
  - **Accept as it is** — the direction goes to the round's acceptance beat
    exactly as a conformant one does, and is carried forward like one.
  - **Redirect** — the stakeholder's redirection takes **Mockup feedback**.
  - **Drop** — `<outlineId>` is the outline this session is saving or
    revising. Before the first save there is no outline. When `<outlineId>`
    is known, from `/root/.cursor/plugins/local/issue-tracker/app` run
    `npm run outline-mockups -- directions <outlineId>`. When that lists
    `<directionId>`, run
    `npm run outline-mockups -- drop <outlineId> <directionId>`.
    That removes the live bundle and deletes that direction's stories from
    the replay tree. `harness.json`, `package.json`, and the other
    directions stay, and a running Storybook updates in place. Name that
    direction id in the note to the mockup author; the name is the author's
    context for the drop. When `<outlineId>` is unknown or directions does
    not list `<directionId>`, stop that conversation's stack with
    `npm run mockup-stack -- stop <conversationId> --ended`. The round ends
    for that screen with no direction, and the plan proceeds without one.
- **A new product question** — when a return raises a product or dependency
  decision the grill has not settled, ask it and have it answered before the
  next screen's round starts.
- **Before the outline** — every mock screen's round ends in an accepted
  direction or a drop before you show the outline.

## Conclude

When the grill is ready (no extra pre-outline confirm):

1. **Write the outline.** **Read**
   `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-publishing-voice.md`
   and follow it. The body opens with `# Background`, then
   `# Implementation` with one `##` section per feature area of concern. It
   has no Epic or Story headings and no implementation order; slicing
   belongs to the decomposer. The section covering each screen whose round
   accepted a direction names that direction id and states its held tweak
   wording.
2. **Save it.** The first save creates the outline under the Project:
   `issue outline add --in <projectId> --title <title> --description-file <path> --source-idea <ideaId>`
   prints `<outlineId>`. Each later save is
   `issue outline set <outlineId> description --file <path>`. Every save is
   the outline's next version.
3. **Judge the code-gate verdict** against the gate rubric's
   `## Code does not need approval when`. **Read**
   `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-consult-supporting-doc.md`
   and consult `gateRubric` per that file using the Bootstrap summary.
   No rubric, or no clause that clearly exempts this outline, is `gated`.
   A clause that clearly exempts it is `start`. The judgment uses that
   section only.
4. **Record the grill's merge settings on the Idea.** When the merge base
   is trunk, run `issue idea set <ideaId> mergePolicy --clear`. When it is
   not trunk and Bootstrap step 6 did not print a branch, run
   `issue idea set <ideaId> mergeBase <branch>`. When it is not trunk, run
   `issue idea set <ideaId> mergePolicy <policy>` with the policy the grill
   settled (`pull-request`, `merge`, `manual`, or `fast-forward`).
5. **Conclude.**
   `issue idea conclude <ideaId> --outline <outlineId> --code-gate-verdict <gated|start>`.
   A zero exit prints `concludedAt`. When a decomposer started, the next
   line is that session id. A non-zero exit means the conclude write
   landed and the decomposer did not start; the final message is stderr.
   Stop. The final message reports `<outlineId>`, the verdict, and
   whether a decomposer started.

## Spawn stubs

Pass these as the Cursor Task `prompt`. Inline the fields each stub lists.
Children own static behavior via their `agents/*.md` files — do not paste
workflow instructions here.

**Delegation** — **Read**
`/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-delegation.md`.

**Focused codebase research** — `role: issue-tracker-research`

> Research: `<focused question>`. Workspace: `<absolute workspace path>`.
> Seed paths (if any): `<paths>`. Ref: `<git ref>` (optional).

## Rules

- Tracker writes that create work happen when conclude starts a decomposer. An outline session's revision, and each save a new planning session lands, is the description save in **## Outline session** and does not start reconciliation.
- Do not edit workspace product source as part of planning (plan artifact /
  grill research reads only).
- Do not start `issue-tracker-work` yourself.
