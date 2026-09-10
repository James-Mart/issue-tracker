# Git — Start Branch

Not a spawnable agent (no frontmatter). Loaded only when Mode is
`start-branch`. Used by `issue-tracker-git`.

Absolute path for this file (Read this exact path):

`/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-git-start-branch.md`

Create is for a Story that does not yet have a branch. The command
creates the branch and the worktree from the Story's derived
`mergeBase`.

1. `issue story worktree create <storyId>`
2. `issue story set <storyId> branchName <storyId>` (git branch name = Story
   issue id; never invent a name from titles)
3. Finish and stop. Do not start Tasks or spawn other agents.
