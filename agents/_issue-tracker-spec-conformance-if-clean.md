# Spec-conformance — If clean

Not a spawnable agent (no frontmatter). Loaded only when the Verify step finds
no gaps. Used by `issue-tracker-spec-conformance-validator`.

Absolute path for this file (Read this exact path):

`/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-spec-conformance-if-clean.md`

1. `issue story set <storyId> specReview passed`
2. Short Story comment:
   `issue story comment <storyId> --role <comment-role> --body "Spec review passed; implementation matches the Task specs."`

Do not edit workspace source files. Finish and stop.
