---
name: issue-tracker-project-docs
disable-model-invocation: true
description: >-
  Author or revise one Project supporting doc (vision, coding standards, or
  design system) and record it in supportingDocs. Use when the user asks to
  write or update project vision, coding standards, design system, or
  supporting docs.
---

# Issue Tracker — Project supporting docs

Author or revise **one** Project supporting document per run and point
`supportingDocs` at it. Docs are consult-if-present for plan/work agents;
this skill only creates or revises them. Glossary and field shape:
[SPEC.md § Project supporting docs](../../SPEC.md#project-supporting-docs).

**Read** `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-cli.md`.

## Argument

Optional: a **Project** id and/or a doc key
(`vision` | `codingStandards` | `designSystem`).

## Flow

### 1. Resolve Project

- If a Project id was given, use it.
- Otherwise resolve from context (`issue summary <id>` → `Project:` line) or
  **Read** `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-resolve-project.md`
  and follow it.
- Confirm with `issue project view <projectId>` (or `issue summary
  <projectId>`). Take `<projectId>` from the id token on
  `Project: <projectId> — <title>`. Note the `Workspace:` /
  `workspace:` line when present (needed only if location is workspace —
  gated in step 3).
- Read current pointers once and keep the JSON for this run:
  `issue project get <projectId> supportingDocs` (empty when unset).

### 2. Select doc key

If the user did not name a key, **prompt** for exactly one of:

| key | label |
| --- | --- |
| `vision` | Vision |
| `codingStandards` | Coding standards |
| `designSystem` | Design system |

Do not invent other keys. One key per run.

**Revise vs create.** From the step-1 JSON: this run is **revising** when
`supportingDocs[<key>]` is present; otherwise it is **creating**. Use that
fork in steps 3–4 (do not re-derive it).

If revising and the existing ref is already `type: "workspace"`, you may
apply the Workspace gate in step 3 early (same stop-and-hand-back rule).

### 3. Choose location

Ask **every run** whether to store as a Project **attachment** or a
**workspace** file (relative to Project `workspace`).

Defaults:

- **Revising** → keep the existing location type and path/basename unless
  the user picks a different one.
- **Creating** → prefer **attachment** with the well-known basename for
  that key:

  | key | basename |
  | --- | --- |
  | `vision` | `vision.md` |
  | `codingStandards` | `coding-standards.md` |
  | `designSystem` | `design-system.md` |

For a new workspace path, ask for a workspace-relative path (no absolute
paths, no `..`).

**Workspace gate.** After the user selects or keeps **workspace** storage:
**Read** `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-workspace-gate.md`
and apply it (use `issue summary <projectId>` / step-1 Project lines as the
summary parameter). Attachment storage does not require a workspace.

### 4. Load current content (revise only)

When **revising**, load from the existing ref in the step-1 JSON:

- **attachment** — `issue project view <projectId>` and Read the **absolute**
  on-disk path printed in the Attachments section
  (`<name> (<n> bytes) — <absolute-path>`). Do not assemble a relative
  `issues/...` path from cwd.
- **workspace** — Read `<Workspace:>/<path>` (join only under Project
  workspace).

If the target is missing or unreadable, tell the user and continue as a
fresh draft for that key (still write + set at the end).

### 5. Grill (`/grill-me`)

Invoke **`/grill-me`** for **this doc only**: goals and content the user wants
captured. Goal-only freeform — **no fixed outline** and no obligatory section
checklist. Stay on the chosen doc; do not grill the other two keys.

Do not write files or set `supportingDocs` until after draft approval (step 6).

### 6. Draft and approve

Draft the full document in chat (Markdown unless the user asked for HTML).
Get an **explicit user approve** of the draft before writing. On rejection,
revise the draft and re-approve — do not write yet.

### 7. Write

**Attachment**

1. If replacing an existing attachment basename (same name already attached,
   or switching content onto a basename that is already present), first
   `issue project detach <projectId> <name>`.
2. Write the approved draft to a temp file whose basename is the chosen
   name, then:
   `issue project attach <projectId> <temp-file>`
3. Use the printed stored basename as `<name>` for step 8 (attach may rename
   on collision — prefer detach-first so the well-known name sticks).

**Workspace**

1. Create or overwrite the file under Project `Workspace:` at the chosen
   relative path (create parent dirs if needed).
2. **Do not** `git add`, `git commit`, or otherwise stage/commit.
3. **Remind the user** that the workspace file will **not** be committed
   automatically — they must commit it themselves if they want it in git.

### 8. Record `supportingDocs`

```bash
# attachment
issue project set <projectId> supportingDocs --doc <key> --attachment <name>

# workspace
issue project set <projectId> supportingDocs --doc <key> --workspace <path>
```

`<path>` is workspace-relative. The file or attachment must already exist
(step 7) — set-time must-exist checks apply.

### 9. Stop

Stop after one doc. Do **not** auto-chain into the other supporting docs.
Offer to run again for another key only if the user asks.

## Notes

- Clearing a key or the whole field is out of band:
  `issue project set <id> supportingDocs --clear [--doc <key>]` — only if the
  user explicitly asks.
- Do not hand-edit `issue.json`. Do not put supporting-doc bodies into
  Project `description.md`.
- When revising `vision`, preserve `## Subsystem reference` unless the user
  asks to change it. Convention:
  [SPEC.md § Project supporting docs](../../SPEC.md#project-supporting-docs).
