# Git — Record Commit

Not a spawnable agent (no frontmatter). Loaded only when Mode is
`record-commit`. Used by `issue-tracker-git`.

Absolute path for this file (Read this exact path):

`/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-git-record-commit.md`

Stage the working tree, commit, and record the new sha. Writes
`issue task add-commit` only — no Task `status` and no other Task field.
A clean tree with nothing to commit is a normal outcome: report it and
stop. No merge or conflict handling.

1. `git status`. If the tree is clean (empty): report that there is
   nothing to commit, then finish and stop.
2. Stage all changes (`git add -A`). Do not pick paths — the implementor
   left everything unstaged for this step. Read the staged diff
   (`git diff --cached`). Compose a single-line subject from what the
   diff does — the Task title is context only, not the message. Voice:
   all lowercase (no exceptions), imperative ("when applied, this commit
   will X"), fewer than 80 characters, no title/body. Then
   `git commit -m "<subject>"`.
3. `issue task add-commit <taskId> $(git rev-parse HEAD)`
4. Finish and stop.
