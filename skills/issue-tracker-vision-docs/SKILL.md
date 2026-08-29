---
name: issue-tracker-vision-docs
disable-model-invocation: true
description: >-
  Author or revise a Project vision doc — the main vision or one subsystem
  vision — through a single grill and an approved draft. Use when writing or
  refining a project vision, authoring a subsystem vision doc, or running
  vision refinement.
---

# Issue Tracker — Vision docs

A vision doc is the pitch for a project or for one of its surfaces: the
idealized answer to "what is this?", written so a reader reaches the value
proposition fast. This skill owns the vision grill — one grill per run, one
quality bar for the doc that comes out of it.

**Read** `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-cli.md`.

**Read** `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-ikigai.md`.

## Argument

A **Project** id when the caller has one, and the subsystem this run covers
when the doc is a subsystem vision. A standalone invocation may also carry
change framing (e.g. "bring it in line with the persona conventions") — carry
that into the grill scope.

## Invoke paths

One path per run, decided by who entered the skill. Every path runs
**## Bootstrap**, **## Opening**, **## Grill**, and **## Draft and approve**.
They differ after the human approves the draft:

- **Standalone** — a Vision refinement conversation or a direct invocation.
  **## Opening** picks main vision or subsystem doc. Write per **## Write**.
- **From project-docs** — `issue-tracker-project-docs` on key `vision`, which
  has already chosen the target. Hand the approved draft back and stop;
  project-docs writes the file and sets `supportingDocs`.
- **From auto-plan** — `issue-tracker-auto-plan` § Subsystem vision consult,
  for a subsystem the plan needs governing vision for. Subsystem doc only. An
  agent invoked this skill, and the grill it runs still belongs to the product
  owner: the seat that asked for the doc does not answer for it. Write per
  **## Write**, then return to auto-plan.

## Bootstrap

1. Use the Project id the caller passed. Without one, **Read**
   `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-resolve-project.md`
   and follow it.
2. `issue summary <projectId>` — one fetch. Keep the Project section for this
   run: `Workspace:`, `supportingDocs:`, `personas:`, and the `Attachments:`
   list (name, size, absolute on-disk path).
3. **Personas catalog** — the `personas:` line lists `<name> — <description>`
   entries. No line means the catalog is empty.
4. **Load what exists** — when `supportingDocs:` carries a `vision=` entry,
   **Read**
   `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-consult-supporting-doc.md`
   and consult key `vision` per that file. Then Read every attachment indexed
   under that doc's `## Subsystem reference`, using the absolute path printed
   for it in the step-2 `Attachments:` list.

## Opening

Settle the target doc first. The other two paths arrive with it already
fixed — project-docs on the main vision at the target it chose, auto-plan on
the subsystem it named. On the standalone path:

1. Ask the product owner whether this run is the **main vision** or a
   **subsystem doc** when the invocation did not say. An agent stakeholder
   holds that seat legitimately; answering for the vision is not part of it.
2. For a subsystem, ask which subsystem when the invocation did not name it.
   Match that name against the `## Subsystem reference` entries loaded in
   Bootstrap step 4: a matching entry makes its attachment the target doc; no
   match makes this a new subsystem doc.

Before drafting any subsystem doc, **Read**
`/root/.cursor/plugins/local/issue-tracker/skills/issue-tracker-vision-docs/references/subsystem-trigger.md`
and apply it to the settled subsystem. One that fails the trigger gets no doc:
name the persona-facing surface whose doc should absorb it, and stop.

Then name the run for the human in one sentence before grilling:

- **Greenfield** — no target doc exists yet: the main vision has no `vision=`
  entry or its target was unreadable, or the subsystem matched no
  `## Subsystem reference` entry.
- **Revise** — the target doc was loaded in Bootstrap step 4.

## Grill

Cover, for the target doc only:

- the pitch — what this project or surface is, and the value it promises,
  including the parts not built yet
- which catalog personas it serves, and what each one gets from it
- the principles or behaviors that make it distinctive
- on a revise run — the caller's change framing, and whether the mission still
  holds
- on a subsystem doc — the split against the main vision: what the main vision
  keeps saying, and what moves here

Architecture, implementation plans, coding standards, and non-goals are outside
the scope of this grill.

Then **Invoke `/grill-me`** for this doc. Exactly one grill per run: every
invoke path runs it, and nothing later in the run reopens the vision interview.

**Personas the draft will name must exist in the catalog.** When the grill
names one that does not, add it before drafting:

```bash
issue project set <projectId> personas --add '{"name":"<name>","description":"<description>"}'
```

## Draft and approve

**Read**
`/root/.cursor/plugins/local/issue-tracker/skills/issue-tracker-vision-docs/references/quality-bar.md`
and draft the whole doc in chat to that bar. Get an **explicit human approve**
before any write. On rejection, revise the draft and re-approve.

## Write

Reached on the standalone and auto-plan paths. Two mechanics, used by both:

**Replace a doc's content**

- **attachment `<name>`** — write the full new content to a temp file whose
  basename is `<name>`, then `issue project detach <projectId> <name>` and
  `issue project attach <projectId> <temp-file>`.
- **workspace `<path>`** — overwrite the file at Project `Workspace:` joined
  with `<path>`, and tell the human it will not be committed for them.

**Attach a new doc** — write the approved draft to a temp file with the chosen
basename, run `issue project attach <projectId> <temp-file>`, and take `<name>`
from the printed stored basename (attach renames on collision).

### Main vision (standalone)

- **Revise** — replace its content at the `vision=` target.
- **Greenfield** — attach it as `vision.md`, then
  `issue project set <projectId> supportingDocs --doc vision --attachment <name>`.

### Subsystem doc (standalone, auto-plan)

1. **Revise** — replace its content at its attachment name. **Greenfield** —
   attach it as `<subsystem>-vision.md`.
2. Index it in the main vision's `## Subsystem reference` (entry shape:
   quality-bar reference) by replacing the main vision's content at the
   `vision=` target. On a revise run, do this only when the entry's name,
   scope, or personas changed.
3. Leave `supportingDocs` unchanged — subsystem docs are attachments, not keys.

## Rules

- One doc per run. Do not chain into a second vision doc; offer to run again.
- Do not hand-edit `issue.json`, and do not `git add` or `git commit`.
