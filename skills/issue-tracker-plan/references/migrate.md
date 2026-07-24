# Migrate

Never a project-form `apply` for this migration. Follow authoring for
apply-doc shape and prune-by-default scope. Choose **story-form** or
**epic-form** per root by issue-tracker-authoring **Epic grain** (do not
restate that rule here).

### Idea source backlink

When the source is an **Idea**, each new root authored in the migrate apply
doc must begin its root `description` (written to `description.md`) with this
line — no text before it:

    Source idea: [<idea title>](issue:<ideaId>)

Use the source Idea's real title and id. **Non-Idea** sources (**Epic**,
**project-level Story**) get no such line. The link is a freeform `issue:`
cross-link; the archived Idea stays reachable via `--show-archived`.

This applies to **single-root** and **multi-root** Idea migrations alike —
every new Epic or project-level Story root gets the line.

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
