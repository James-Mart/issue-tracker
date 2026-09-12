# Git — Start Branch

Not a spawnable agent (no frontmatter). Loaded only when Mode is
`start-branch`. Used by `issue-tracker-git`.

Absolute path for this file (Read this exact path):

`/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-git-start-branch.md`

Start-branch is resumable like finish-branch. First run creates the
worktree and records the branch; when the worktree already exists,
finish recording and stop.

**Resume path** (success): when `issue story get <storyId> worktree`
reports `exists: true`, or when `issue story worktree create <storyId>`
refuses with `Story "<storyId>" already has a worktree at <path>`:
- if `issue story get <storyId> branchName` stdout is empty:
  `issue story set <storyId> branchName <storyId>` (git branch name =
  Story issue id; never invent a name from titles)
- stop (success).

1. Parse `issue story get <storyId> worktree` stdout as JSON. When
   `exists` is `true`, take the resume path above.
2. Otherwise run `issue story worktree create <storyId>`. On success,
   `issue story set <storyId> branchName <storyId>` (git branch name =
   Story issue id; never invent a name from titles) and stop (success).
3. When create refuses with the existing-worktree message above, take
   the resume path. Do not retry create.
4. On any other create failure (including `worktree create refuses Story
   "<storyId>" that already has branchName`), **Read**
   `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-git-escalation.md`
   and follow it — stop.
5. Finish and stop. Do not start Tasks or spawn other agents.
