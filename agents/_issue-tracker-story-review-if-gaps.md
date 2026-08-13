# Story review — If gaps

Not a spawnable agent (no frontmatter). Loaded only when the Verify step finds
gaps. Used by `issue-tracker-story-review`.

Absolute path for this file (Read this exact path):

`/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-story-review-if-gaps.md`

1. `issue story set <storyId> review failed`
2. `issue story set <storyId> reviewedTasks '<json array of the done Task ids from Verify>'`
   (full replace; the coverage list from Verify step 2)
3. Create one remediation Task per distinct fix, piping the concrete spec
   via stdin — do **not** use inline `--description`:
   ```bash
   issue task add --part-of <storyId> --file - \
     "<title from the finding>" <<'EOF'
   <concrete fix spec>
   EOF
   ```
   Capture each Task id printed on stdout.
4. Story comment that links the new Task(s) only — findings live on the Task
   descriptions, not duplicated in the Story comment body. Use GFM
   `issue:` links so the UI renders an `IssueLink`:
   `issue story comment <storyId> --role story-review --body "Story review failed; remediation: [issue:<newTaskId>](issue:<newTaskId>), …"`
5. If any step after `review failed` fails, escalate with the error — do
   not leave `failed` with no remediation Task/link silently.

Do not edit workspace source files. Finish and stop.
