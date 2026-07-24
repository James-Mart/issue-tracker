# Git — Finish Commit

Not a spawnable agent (no frontmatter). Loaded only when Mode is
`finish-commit`. Used by `issue-tracker-git`.

Absolute path for this file (Read this exact path):

`/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-git-finish-commit.md`

Decide from exactly two facts: the Task's `noDiff` flag (from
`issue task get <taskId> noDiff`) and the working-tree state (`git status`).
Never parse chat.

| `noDiff` | Tree | Action |
|----------|------|--------|
| true | clean (empty) | `issue task set <taskId> status done` only — no `git commit`, no `commitSha`; leave `noDiff` set. Then finish and stop. |
| true | dirty | `issue task set <taskId> needsAttention true --reason "..."` — the flag contradicts a non-empty tree. Then stop. |
| absent/false | clean (empty) | `issue task set <taskId> needsAttention true --reason "..."` — an empty tree without `noDiff` is not a completion signal. Then stop. |
| absent/false | dirty | Stage, commit, and record — steps below. |

The `true` / clean row is a legitimate `done` outcome even when a
non-source-controlled file was edited (git status stays clean); that is not a
contradiction with `noDiff`.

For the **dirty + no `noDiff`** row:

1. Stage **all** uncommitted changes (`git add -A`). Do not pick paths —
   the implementor left everything unstaged for this finalize step.
2. `git commit -m "<Task title>"` (message = the Task issue's title).
3. `issue task set <taskId> status done`
4. `issue task set <taskId> commitSha $(git rev-parse HEAD)`
5. Finish and stop.
