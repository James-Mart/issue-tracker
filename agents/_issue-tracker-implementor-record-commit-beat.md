# Implementor — Record commit beat

Not a spawnable agent (no frontmatter). Last beat of an implement or
revise entry. Used by the implementor implement and revise mode includes.
Callers **Read** this file from disk — a markdown link alone is not enough.

Absolute path for this file (Read this exact path):

`/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-implementor-record-commit-beat.md`

Spawn the **Record commit** stub. An implement or revise entry records one
commit, and none at all when the Task is flagged `noDiff` or when the
entry answers feedback without changing code. A zero-commit entry is a
normal outcome, not a failure.
