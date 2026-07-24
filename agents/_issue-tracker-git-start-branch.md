# Git — Start Branch

Not a spawnable agent (no frontmatter). Loaded only when Mode is
`start-branch`. Used by `issue-tracker-git`.

Absolute path for this file (Read this exact path):

`/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-git-start-branch.md`

1. `git checkout <mergeBase>`
2. `git checkout -b <storyId>`
3. `issue story set <storyId> branchName <storyId>` (git branch name = Story
   issue id; never invent a name from titles)
4. Finish and stop. Do not start Tasks or spawn other agents.
