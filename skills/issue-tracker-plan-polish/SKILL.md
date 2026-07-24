---
name: issue-tracker-plan-polish
disable-model-invocation: true
description: >-
  Polish an existing Epic or project-level Story plan tree with parallel
  check agents, then auto-apply when safe. Use when the user asks to polish
  a plan, clean up a tracker tree, or run plan-polish.
---

# Issue Tracker — Plan Polish

Polish one **work root** — an **Epic** or a **project-level Story** — already
in the tracker. You are the **coordinator**: spawn read-only check agents,
compose a full apply doc from their findings (keep it internal), auto-apply
when safe, then show a short findings + changes summary in chat. Checkers
advise; the planner may stop continued polish (veto) when returns diminish —
leftover findings still appear in the summary. Behavioral contract: Epic
**auto-plan-polish-confirm** invariants (auto-apply + post-summary; escalate
only when unsafe) — do not restate that list here.

**Read** `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-cli.md`.

## Argument

An **Epic** id (any `epicStatus` — not limited to `todo`) or a
**project-level Story** id (`partOf` the Project). If none is given:

1. **Read** `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-resolve-project.md`
   and follow it. Never bare `issue list`.
2. Run `issue tree <projectId>` and ask which Epic or project-level Story.

## Bootstrap

1. `issue summary <rootId>` — read `Project:` and `Workspace:`.
   **Read** `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-workspace-gate.md`
   and apply it using this summary output (before spawning anything).
   Apply **Work-root kind gates** from
   [`agents/_issue-tracker-plan-polish-check-base.md`](../../agents/_issue-tracker-plan-polish-check-base.md)
   § Bootstrap (bind `<rootKind>`; do not restate that block here).
2. **Read** `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-consult-supporting-doc.md`,
   then consult `vision` per that file using the step-1 summary output.
3. `issue tree <rootId>` — full Story/Task outline (implementation
   order).
4. `issue <rootKind> view <rootId>` (and children as needed) when preparing the
   retained plan.

## Parallel check agents

Spawn **all five** agents **in parallel** (one Cursor Task each) via the
**Spawn stubs** below. Pass **only** the fields each stub lists — children own
static behavior in `agents/*.md`; do not paste agent workflow into the prompt.

| Agent (`subagent_type`) | Cursor Task `model` |
| --- | --- |
| `issue-tracker-plan-no-ambiguity` | `composer-2.5` |
| `issue-tracker-plan-dry` | `composer-2.5` |
| `issue-tracker-plan-authoring-conformance` | `composer-2.5` |
| `issue-tracker-plan-dependency-order` | `cursor-grok-4.5-high-fast` |
| `issue-tracker-plan-internal-consistency` | `composer-2.5` |

Each agent template is `readonly: true`. Shared CLI/bootstrap/JSON output
contract lives only in
[`agents/_issue-tracker-plan-polish-check-base.md`](../../agents/_issue-tracker-plan-polish-check-base.md)
— do not restate the findings schema here.

**Internal-consistency supportingDocs scope.** That check compares the tree
against `vision` (when set) and `codingStandards` only when tree prose makes
claims that doc governs. It does **not** compare against `designSystem` —
design-system adherence is enforced at implementation time, not during plan
polish. Details:
[`agents/issue-tracker-plan-internal-consistency.md`](../../agents/issue-tracker-plan-internal-consistency.md)
and SPEC § Project supporting docs.

## Spawn stubs

Pass these as the Cursor Task `prompt`. Inline the work-root id/title. Children
own static behavior via their `agents/*.md` files — do not paste workflow
instructions here.

**Work-root context line** — shared prefix for all five check stubs:

> Work root: `<rootId>` (`<title>`).

**Findings return line** — append to every check stub (gate-critical; stubs
are re-read each spawn while agent injection may be frozen):

> Return only a JSON findings array per
> `agents/_issue-tracker-plan-polish-check-base.md` (detection-only — no
> fixes; no prose wrapper).

**No-ambiguity** — `subagent_type: issue-tracker-plan-no-ambiguity`
(`model: composer-2.5`)

> *(Work-root context line.)* *(Findings return line.)*

**DRY** — `subagent_type: issue-tracker-plan-dry` (`model: composer-2.5`)

> *(Work-root context line.)* *(Findings return line.)*

**Authoring conformance** —
`subagent_type: issue-tracker-plan-authoring-conformance`
(`model: composer-2.5`)

> *(Work-root context line.)* *(Findings return line.)*

**Dependency order** —
`subagent_type: issue-tracker-plan-dependency-order`
(`model: cursor-grok-4.5-high-fast`)

> *(Work-root context line.)* *(Findings return line.)*

**Internal consistency** —
`subagent_type: issue-tracker-plan-internal-consistency`
(`model: composer-2.5`)

> *(Work-root context line.)* *(Findings return line.)*

## Aggregate → apply → summary

After all five check agents return, **Read**
`/root/.cursor/plugins/local/issue-tracker/skills/issue-tracker-plan-polish/references/aggregate-apply-summary.md`
and follow it.

## Rules

- Check agents never write the tracker; only this coordinator writes, and only
  when auto-apply is safe (or after the user resolves an escalate).
- Do not ask the user to approve before `issue apply` when fixes are clear.
- Do not auto-chain into `issue-tracker-work` or other skills.
- Do not edit workspace source files as part of polish (tracker plan only).
