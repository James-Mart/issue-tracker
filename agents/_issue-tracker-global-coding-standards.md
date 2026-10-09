# Global coding standards

Not a spawnable agent (no frontmatter). Plugin-level rules that every
implementor (`## Global coding standards` in `_issue-tracker-implementor.md`)
and `issue-tracker-review-coding-standards` read regardless of Project.
Callers **Read** this file from disk — a markdown link alone is not enough.

Absolute path for this file (Read this exact path):

`/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-global-coding-standards.md`

Project `codingStandards` supporting docs add Project-specific rules on top of
this include.

## Comments

Write comments for the next reader of the code, not the reviewer of this change.
A comment belongs where it tells that reader something the code at that spot
doesn't already show: what an interface does for a caller who won't read its
body, or a constraint or reason the code can't express. Leave out narration of
the lines it sits above, the history of the change, and arguments that the
change is correct. Match the comment density and style of the surrounding code.
