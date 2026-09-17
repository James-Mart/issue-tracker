# Git — Record Commit

Not a spawnable agent (no frontmatter). Loaded only when Mode is
`record-commit`. Used by `issue-tracker-git`.

Absolute path for this file (Read this exact path):

`/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-git-record-commit.md`

Stage the working tree, commit, and record the new sha. Writes
`issue task add-commit` only — no Task `status` and no other Task field.

Run every `git` command with the `Workspace:` path from
`issue summary <taskId>` as cwd. After start-branch that path is the
Story worktree.

1. `git rev-parse -q --verify MERGE_HEAD`.
2. **When it succeeds** (merge in progress):
   - If unmerged paths remain (`git diff --name-only --diff-filter=U` is
     non-empty): `issue task set <taskId> needsAttention true --reason "..."`
     naming those paths. Then stop — no `git add`, no commit, no
     `add-commit`.
   - Otherwise: `git add -A`, then `git commit --no-edit` with no `-m` (Git
     uses `MERGE_MSG`). Then `issue task add-commit <taskId>
     $(git rev-parse HEAD)` only — do not persist subject or body on the
     Task. Then finish and stop.
3. **When it fails** (no merge in progress):
   - `git status`. If the tree is clean (empty): report that there is
     nothing to commit, then finish and stop.
   - Otherwise stage all changes (`git add -A`). Do not pick paths — the
     implementor left everything unstaged for this step. Read the staged diff
     (`git diff --cached`). Compose a single-line subject from what the
     diff does — the Task title is context only, not the message. Voice:
     all lowercase (no exceptions), imperative ("when applied, this commit
     will X"), fewer than 80 characters, no title/body. Then
     `git commit -m "<subject>"`.
   - `issue task add-commit <taskId> $(git rev-parse HEAD)`.
   - Finish and stop.
