# Git — Escalation

Not a spawnable agent (no frontmatter). Loaded when git mode work is blocked.
Used by `issue-tracker-git`.

Absolute path for this file (Read this exact path):

`/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-git-escalation.md`

Raise attention and stop — do not guess:

| Scenario | Command |
|----------|---------|
| start-branch / finish-branch blocked (checkout failure, missing required Story facts, push rejection, PR-create failure, merge conflict, CLI refusal) | `issue story set <storyId> needsAttention true --reason "..."` |
| finish-commit blocked (other than the two matrix rows that already inline the command) | `issue task set <taskId> needsAttention true --reason "..."` |

For finish-branch recovery follow SPEC § Project merge policy: abort a `merge`
**conflict** (`git merge --abort`) so the `mergeBase` ref is never
half-merged, but leave a *completed* local merge whose push failed in place
(the retry re-pushes).
