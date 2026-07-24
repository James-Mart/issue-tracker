# Spec-conformance — If gaps

Not a spawnable agent (no frontmatter). Loaded only when the Verify step finds
gaps. Used by `issue-tracker-spec-conformance-validator`.

Absolute path for this file (Read this exact path):

`/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-spec-conformance-if-gaps.md`

1. `issue story set <storyId> specReview failed`
2. Create one remediation Task. Pipe the concrete fix list (multiline
   Markdown) via stdin — do **not** use inline `--description`:
   ```bash
   issue task add --part-of <storyId> --file - \
     "Address spec-conformance findings for <storyId>" <<'EOF'
   <concrete fix list>
   EOF
   ```
   Capture the Task id printed on stdout.
3. Story comment that links the new Task only — findings live on the Task
   description, not duplicated in the Story comment body. Use a GFM
   `issue:` link so the UI renders an `IssueLink`:
   `issue story comment <storyId> --role <comment-role> --body "Spec review failed; remediation: [issue:<newTaskId>](issue:<newTaskId>)"`
4. If any step after `specReview failed` fails, escalate with the error — do
   not leave `failed` with no remediation Task/link silently.

Do not edit workspace source files. Finish and stop.
