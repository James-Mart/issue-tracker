# Story review — If gaps

Not a spawnable agent (no frontmatter). Loaded only when the Verify step
finds gaps. Used by `issue-tracker-story-review`.

Absolute path for this file (Read this exact path):

`/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-story-review-if-gaps.md`

1. `issue story set <storyId> review failed`
2. `issue story set <storyId> reviewedTasks '<json array of the done Task ids from Verify>'`
   (full replace; the coverage list from Verify step 2)
3. Write a story-form YAML doc outside the workspace with one remediation
   Task per distinct fix, and append it with
   `issue story append <storyId> <file>`. `issue summary` names the Project
   and, when the Story sits under an Epic, the Epic. Include `epic` only
   when that Epic line is present. Restate the Story id and title. Each
   Task is `kind: task` with an unused kebab-case `id`, the finding's
   title, and a `description` block scalar (`|`) that names the defect and
   the outcome the fix must reach. Capture the created Task ids that append
   prints.
4. Story comment that links the new Task(s) only — findings live on the Task
   descriptions, not duplicated in the Story comment body. Use GFM
   `issue:` links so the UI renders an `IssueLink`:
   `issue story comment <storyId> --role story-review --body "Story review failed; remediation: [issue:<newTaskId>](issue:<newTaskId>), …"`
5. If any step after `review failed` fails, escalate with the error — do
   not leave `failed` with no remediation Task/link silently.

Do not edit workspace source files. Then continue at story review's
**Runtime outcome** step.
