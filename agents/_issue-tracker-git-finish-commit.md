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

1. Detect an in-progress merge with `git rev-parse -q --verify MERGE_HEAD`.
2. **When it succeeds:**
   - If unmerged paths remain (`git diff --name-only --diff-filter=U` is
     non-empty): `issue task set <taskId> needsAttention true --reason "..."`.
     Then stop.
   - Otherwise: `git add -A`, then `git commit --no-edit` with no `-m` (Git
     uses `MERGE_MSG`).
3. **When it fails** (no merge in progress): stage all changes (`git add -A`).
   Do not pick paths — the implementor left everything unstaged for this
   finalize step. Read the staged diff (`git diff --cached`). Compose a
   single-line subject from what the diff does — the Task title is context
   only, not the message. Voice: all lowercase (no exceptions), imperative
   ("when applied, this commit will X"), fewer than 80 characters, no
   title/body. Then `git commit -m "<subject>"`.
4. `issue task set <taskId> status done`
5. `issue task set <taskId> commitSha $(git rev-parse HEAD)`
6. Finish and stop.
