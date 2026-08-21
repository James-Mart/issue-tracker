# Migrate

Never a project-form `apply` for this migration. Use the **story-form** or
**epic-form** already chosen for the approved outline.

### Merge-base and policy

After **each** successful root `apply`, record the merge-base and policy from
the grill (**Merge-base first** bullet in **Rules (mandatory):** in the parent
skill):

| Grill merge-base | Post-apply |
| --- | --- |
| **Trunk** | (none) |
| **Non-trunk branch** | `issue <rootKind> set <rootId> mergeBase <branch>` then `issue <rootKind> set <rootId> mergePolicy <policy>` |

`<rootKind>` is `story` or `epic` matching the apply shape; `<rootId>` is the
resulting root id from that apply. Imperative only — not in the YAML doc.

- When the source is an **Idea**, after each successful root `apply`:
  `issue epic set <rootId> sourceIdea <ideaId>` for an epic-form root, or
  `issue story set <rootId> sourceIdea <ideaId>` for a story-form root.
  `<rootId>` is the resulting root id from that apply; `<ideaId>` is the
  source Idea's id. Applies to **single-root** and **multi-root** Idea
  migrations alike. **Non-Idea** sources (**Epic**, **project-level Story**)
  record nothing — imperative only, not in the YAML doc.
- Verification-only Tasks (intentionally no source-controlled edits): after
  `apply`, `issue task set <taskId> noDiff true` per
  [Verification-only Tasks (noDiff)](../../issue-tracker-authoring/SKILL.md#verification-only-tasks-nodiff)
  — imperative only, not in the YAML doc.

### Single root (not splitting)

One epic-form or story-form apply. Keep existing in-place / Idea-archive
behavior:

**Story-form** — `project: <projectId>` string + `story:` object (no `epic:`):

| Source | Story id in the doc | After successful `apply` |
| --- | --- | --- |
| **Idea** | Mint a **new** kebab id — **do not reuse the Idea id** | `issue idea set <ideaId> archived true` |
| **project-level Story** (`not-started`) | **Keep** the existing Story id | (none) |

**Epic-form** — `project: <projectId>` string + `epic:` object:

| Source | Epic id in the doc | After successful `apply` |
| --- | --- | --- |
| **Idea** | Mint a **new** kebab id — **do not reuse the Idea id** | `issue idea set <ideaId> archived true` |
| **Epic** (`todo`) | **Keep** the existing Epic id | (none) |
| **project-level Story** (`not-started`) | Mint a **new** kebab Epic id; **keep** the existing Story id as a child under that Epic | (none) |

Show `apply` stdout (and archive outcome on the Idea path). Report the
resulting Story or Epic id.

### Multi-root (splitting)

N separate epic-form / story-form applies — one per resulting root. Roots may
mix Epics and project-level Stories. **Always mint new root ids** (do not reuse
the source Idea / Epic / Story id as any new root id).

1. Apply in **`blockedBy` order** when deps exist among the new Epic roots;
   otherwise any order.
2. On **first apply failure:** stop. Leave already-written roots in place. Do
   **not** delete the source. No automatic rollback.
3. Only after **every** apply in the migrate succeeds: archive or delete the
   source — `issue idea set <ideaId> archived true`, `issue epic delete
   <epicId>` (source was `todo`), or `issue story delete <storyId>` (source
   was not-started project-level Story), as appropriate.

Show each `apply` stdout and the final archive/delete outcome. Report every
resulting root id.
