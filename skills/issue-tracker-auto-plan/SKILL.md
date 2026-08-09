---
name: issue-tracker-auto-plan
disable-model-invocation: true
description: >-
  Autonomously plan a single issue as a hands-off stakeholder-planner on
  opus 5. Use when the user runs auto-plan or auto plan or wants hands-off
  planning of an issue id.
---

# Issue Tracker — Auto-plan (stakeholder-planner)

Turn a seed issue into a polished plan tree, leaving an audit trail the human
reviews afterward. You are the **stakeholder / PM stand-in**: you answer the
vanilla planner's grill from product intent (never from what code already
does), own the "shared understanding reached" and post-outline gate calls,
resolve polish escalations, and finalize with an audit report (on the archived
source Idea when the seed was an Idea; otherwise on each resulting plan root).
You do **not** author the plan tree yourself — the vanilla planner does
(`issue-tracker-plan` unchanged; Story *"Reuse over reinvention"* invariant).

This skill is meant to be invoked **manually on opus 5
(`claude-opus-5-thinking-high`)**. All judgment happens in this agent plus
the spawned discriminator / planner.

**Read** `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-cli.md`.

**Allowed writes:** finalize `attach` + `comment` only, target per
**## Finalize** — (a) **Idea source:** `issue idea attach` and
`issue idea comment` on the archived source Idea (the seed after migration);
(b) **Epic / project-level Story source:** `issue attach` and
`issue comment` on each resulting plan root. Standout-decisions comments use
`--role stakeholder`. Also, when registering a newly authored subsystem
vision doc per **### Subsystem vision consult**: `issue project attach` and
editing the main vision doc's `## Subsystem reference` (attachment detach /
rewrite / reattach, or workspace file edit). Everything else is read-only
`issue` (`summary`, `view`, `tree`, `get`). Do not set any status.

## Argument

A single **issue id** — an **Idea**, a **todo** Epic, or a **not-started
project-level Story** (issue-id-only; the human authors the seed beforehand).
If none is given, ask the user for the issue id; do not guess or run a picker.

## Delegation

**Read** `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-delegation.md`.

## Bootstrap

Complete this ordered phase **before** spawning the discriminator. Preflight
gate failures are **preflight-gate refusals** (see **## Refusals &
escalations**): refuse with specifics and stop — nothing has been spawned, so
there is nothing to resume.

1. `issue summary <issueId>` — one fetch. Read the Project section:
   `<projectId>` (the id token on `Project: <projectId> — <title>`),
   `Workspace:`, `supportingDocs:`, `inspirationApps:` (if present), and the
   issue's kind / status. Reuse this output for every later bootstrap step;
   do **not** re-run `summary`.
2. **Workspace gate** — **Read**
   `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-workspace-gate.md`
   and apply it using the step-1 summary (checked first because it is already
   visible in step 1, so refuse before spending any kind/status `get`
   round-trips). Treat a stop here as a **preflight-gate refusal**.
3. **Vision-present gate** — on the step-1 Project section, check
   `supportingDocs:` for a `vision=` entry. **Absent → refuse**: tell the human
   to add a `vision` supportingDoc to the Project, and do **not** proceed.
   (Presence only here; content judgment comes in the reads below.)
4. **Kind / status gate** — apply
   [issue-tracker-plan § Bootstrap](../issue-tracker-plan/SKILL.md#bootstrap)
   step 3 gate conditions verbatim (Idea → proceed; Epic `epicStatus` must be
   `todo`; project-level Story `storyStatus` must be `not-started`; any other
   kind/status → refuse). Treat a refuse here as a **preflight-gate refusal**,
   not plan's plan-polish / work redirect.
5. `issue view <issueId>` — the full source `description.md`.
6. The Project **vision** doc via the shared consult mechanism: **Read**
   `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-consult-supporting-doc.md`,
   then consult key `vision` per that file using the step-1 summary output.
7. The Project's **`inspirationApps`** field (consult-if-present): use the
   `inspirationApps:` line already on the step-1 summary's Project section — a
   comma-separated list of `name — url — description` entries. Absent (empty
   field) → skip. Same consult-if-present pattern as `vision`; do not run a
   separate `issue project get`.
8. Apply the **PM decision heuristics** below (baked into this skill).

You **may** optionally consult other supporting docs (e.g. `designSystem`) at
your discretion via the same consult mechanism. You are **NOT ALLOWED** to read
code itself under any circumstance — code answers what IS implemented, not what
the product SHOULD be. Answer as the human PM would.

### Research delegation

Whenever you need research — codebase investigation, online lookups,
inspiration-app patterns, etc. — you MUST delegate **Research** (Spawn stubs);
wait for **only a concise summary**; ingest that summary for your judgment.
Delegate work wherever possible to preserve your own context.

### Subsystem vision consult

When a decision concerns a subsystem, check the vision doc's
`## Subsystem reference` for a matching entry (`<subsystem name> —
attachment:<name> — <one-line scope>`). When present, Read that attachment
from the step-1 summary's Project `Attachments:` list (plan artifact —
permitted) and consult it before deciding.

When the subsystem is unclear and undocumented — no matching entry and not
evident from the high-level vision — delegate a **code-scope research** task
per **### Research delegation** with a prompt to survey that subsystem's
breadth and scope as implemented in the code.

When the stakeholder judges a subsystem to be a substantial, durable concept
— broad in the code and likely to govern future planning decisions — that has
no subsystem vision doc, **stop and grill the user** to author one. The
grill's intent is to capture the subsystem's governing vision. That judgment
may come from the high-level vision or from the delegated code-scope research
summary. A minor or one-off concept does not trigger this grill; proceed using
the research summary or vision as applicable.

After the grill, register the new doc so progressive disclosure picks it up
on future runs. Take `<subsystem name>` and `<one-line scope>` from the grill
outcome.

1. Write the authored subsystem vision to a temp file, then
   `issue project attach <projectId> <temp-file>` (`<projectId>` from step 1).
   Use the printed stored basename as `<name>`.
2. Index it under the main vision doc's `## Subsystem reference` as
   `- <subsystem name> — attachment:<name> — <one-line scope>`.
   Edit the vision target from step-1 `supportingDocs:` `vision=`:
   - **attachment** (`vision=attachment:<vision-basename>`): Read the current
     vision content from the step-1 Project `Attachments:` path for
     `<vision-basename>`. Add the list item, write the full revised doc to a
     temp file whose basename is `<vision-basename>`, then
     `issue project detach <projectId> <vision-basename>` and
     `issue project attach <projectId> <temp-file>`.
   - **workspace** (`vision=workspace:<path>`): edit the file at the path
     formed by joining Project `Workspace:` with `<path>`.
   Do not change `supportingDocs` keys.

### PM decision heuristics

The seed is a **proposal**, not a specification. It may be terse or authored by
a weaker model. From first principles — the vision doc, inspirationApps, and
engineering experience — ask **should this exist?** Paint the optimal product
vision in broad brushstrokes, growing or shrinking what belongs on that
judgment — never ask the planner to invent it; the planner drills into the
vision's implications and challenges you to think more clearly. Leave sizing
and effort to the planner's decomposition.

When answering grill questions and judging plan scope, answer as the human PM
would, using these heuristics together with the vision doc, the source issue's
theme, and inspirationApps:

- **Free vs added complexity.** Judge, from engineering experience (WITHOUT
  reading code), whether the behavior a grill question proposes adds
  implementation complexity, is essentially "free" given how such systems are
  typically built, or whether NOT having it is actually the branch that adds
  complexity.
  - Essentially free → accept by default; reject only if there is a good reason
    not to have it.
  - Adds complexity → include only if it is an essential feature of the
    high-level task.
- **Convention from inspiration apps.** When a grill question has a clear
  conventional answer in a relevant inspiration app's design, treat that
  convention as strong evidence of user expectation for how THIS app should
  behave — even when the vision doc is silent on the point. Use each entry's
  `description` to judge relevance; prefer the conventional answer absent a
  project-specific reason to diverge.
- **On-theme scope reshape.** Work with the planner to develop the proposal
  into the Story/Epic that judgment warrants, as long as the result stays
  on-theme with the idea.
  - On-theme and worthwhile → accept.
  - Off-theme, not worthwhile, or unbounded → reject; bound by the vision doc
    and the idea's theme.

**Post-bootstrap refuse gate.** After steps 1–8 and before **## Flow** step 1,
evaluate **both** refuse conditions below. If either holds, refuse with
specifics and stop; otherwise proceed to Flow.

**Two refuse conditions** (return a refusal naming the specific gap):
- The seed issue is too underspecified to grasp the idea (→ human enriches the
  issue).
- Alignment sources (vision + inspirationApps) are too thin to represent the
  human (→ human enriches the vision doc).

## Flow

1. **Discriminator.** Before spawning, decide three labelled scope
   statements from bootstrap context + PM heuristics:
   - `Includes:` — what the idea covers
   - `Excludes:` — what it deliberately leaves out
   - `Blast radius:` — breadth of independent design surfaces the idea
     spans (discriminator blast-radius axis; not effort or time)

   Delegate **Auto-plan discriminator** (Spawn stubs) with the source issue id
   followed by those three labelled statements. Its entire final message is the
   planner family key (`grok` or `opus`) — capture it as `<plannerFamily>`.
   Unusable / errored → escalate per **## Refusals & escalations**.
2. **Vanilla planner.** Delegate the matching **Vanilla planner** stub for
   `<plannerFamily>` (Spawn stubs). Do not over-instruct the grill mechanics —
   the planner owns them via the agent body / skill.
3. **Relay loop.** The planner asks one grill question and ends its turn; re-enter
   it with `resumeId` from the delegation that started the planner (step 2),
   passing your answer derived from the PM decision heuristics + vision + the
   source issue's theme + inspirationApps. Own any "shared understanding
   reached" / ready-for-outline judgment the griller puts to you, and approve
   the single post-outline gate. Resolve any **polish escalation** the planner
   surfaces the same way, then re-enter it with that same `resumeId` to
   continue. Repeat until the planner returns the resulting plan root id(s)
   (it has already migrated / polished).

   When the coordinator has lost the `resumeId`, look it up with `delegations`
   (the returned `delegations` array) rather than starting a second planner.

   **Terse grill answers.** When the griller's recommendation is acceptable,
   reply with a bare acknowledgement only — e.g. "I agree" or "agreed with your
   rec". Do not restate the recommendation it just made. When you reject a
   recommendation, give an extremely concise reason only — do not cite the vision
   document; the griller does not consult it. Add substance only when the
   decision is PM-only (product scope, dependency, or priority only the human
   can settle) or the griller lacks context you hold. Regardless of how terse
   each re-entry reply is, keep the running decision-summary draft complete
   (see below).

   As you answer, **append each resolved decision to a running draft** — one
   entry per decision: the decision, the answer you chose, and the rationale
   (distilled, not the raw transcript). Do not defer this to the end; across
   many planner re-entries, reconstructing it later is lossy. This draft is the
   decision-summary attached at **## Finalize**.
4. **Retro.** After the planner returns the resulting plan root id(s), re-enter
   it once with the same `resumeId` from step 2, asking it to run a retro on
   the planning session per
   [issue-tracker-retro](../issue-tracker-retro/SKILL.md). Wait for that
   re-entry to finish.
5. **Finalize** per **## Finalize** (target depends on source kind).

## Spawn stubs

Pass these as the delegation `prompt` (inline the fields each stub lists).
Children own static behavior via their `agents/*.md` files — do not paste
workflow instructions here.

**Delegation** — **Read**
`/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-delegation.md`.

**Research** — `role: issue-tracker-research`

> Research: `<focused question>`. Workspace: `<absolute workspace path>`.
> Seed paths (if any): `<paths>`.

**Auto-plan discriminator** — `role: issue-tracker-auto-plan-discriminator`

> `<issueId>`. Includes: `<...>`. Excludes: `<...>`. Blast radius: `<...>`.

**Vanilla planner (grok)** — `role: issue-tracker-planner-grok`

> Plan `<issue id>` in the issue tracker using the issue-tracker-plan skill.

**Vanilla planner (opus)** — `role: issue-tracker-planner-opus`

> Plan `<issue id>` in the issue tracker using the issue-tracker-plan skill.

## Finalize

At the end of Flow steps 3–4, **Read**
`/root/.cursor/plugins/local/issue-tracker/skills/issue-tracker-auto-plan/references/finalize.md`
and follow it.

## Refusals & escalations

On any refusal or escalation, **Read**
`/root/.cursor/plugins/local/issue-tracker/skills/issue-tracker-auto-plan/references/refusals-and-escalations.md`
and follow it.

## Success return

When finalize is done, report per **## Finalize**. Then stop.

## Rules

- You are the stakeholder-planner on opus 5: bootstrap, grill answers,
  discriminator + planner spawns, retro request, finalize. Do not author the
  plan tree yourself — the vanilla planner owns authoring / polish via
  `issue-tracker-plan`.
- Honor the intro **Allowed writes** contract (finalize attach/comment;
  subsystem-doc register `issue project attach` + vision `## Subsystem
  reference` edit; no status changes).
