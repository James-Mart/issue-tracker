# Story review — If clean

Not a spawnable agent (no frontmatter). Loaded only when the Verify step finds
no gaps. Used by `issue-tracker-story-review`.

Absolute path for this file (Read this exact path):

`/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-story-review-if-clean.md`

1. `issue story set <storyId> review passed`
2. `issue story set <storyId> reviewedTasks '<json array of the done Task ids from Verify>'`
   (full replace; the coverage list from Verify step 2)
3. Short Story comment:
   `issue story comment <storyId> --role story-review --body "Story review passed."`

Do not edit workspace source files. Finish and stop.
