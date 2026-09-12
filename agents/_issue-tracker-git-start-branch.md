# Git — Start Branch

Not a spawnable agent (no frontmatter). Loaded only when Mode is
`start-branch`. Used by `issue-tracker-git`.

Absolute path for this file (Read this exact path):

`/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-git-start-branch.md`

Start-branch is resumable like finish-branch. First run creates the
worktree and records the branch; when the worktree already exists,
finish recording and stop.

1. **Idempotent end state:** parse `issue story get <storyId> worktree`
   stdout as JSON. When `exists` is `true`:
   - if `issue story get <storyId> branchName` stdout is empty:
     `issue story set <storyId> branchName <storyId>` (git branch name =
     Story issue id; never invent a name from titles)
   - stop (success).
2. Otherwise run the first-run pair:
   - `issue story worktree create <storyId>`
   - `issue story set <storyId> branchName <storyId>` (git branch name =
     Story issue id; never invent a name from titles)
3. Finish and stop. Do not start Tasks or spawn other agents.

On any other `worktree create` failure, **Read**
`/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-git-escalation.md`
and follow it — stop.
