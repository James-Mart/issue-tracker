The Story's merge base has moved underneath its branch. Bring the branch
up to date.

### Do

Immediately before the merge, run `issue story get {{storyId}} mergeBaseRef`.
When that get exits nonzero, run
`issue story set {{storyId}} needsAttention true --reason "mergeBaseRef get failed"`
and stop. Do not merge. When it prints a ref, merge that ref into
`{{branchName}}` with `git merge --no-commit`, so the merge does not
auto-commit.

A conflicted path is discernable only when it is source text and the
combination is unambiguous: both sides can be kept, or one side is strictly
obsolete. A product choice, competing behavior, or uncertain intent is not
discernable. A generated or tool-owned file, such as a lockfile, or a binary,
is not discernable.

Resolve every discernable path and `git add` it. Leave every path that is not
discernable unmerged.

When any path is still unmerged, stop before record-commit. Raise
`issue task set <id> needsAttention true --reason "..."` and name each
still-conflicted path in the reason. Do not abort the merge.

When the task is resumed after attention is cleared: if any path is still
unmerged, raise attention again naming those paths, and do not take another
autonomous pass on them. When nothing is unmerged, do not re-judge the
resolutions. Leave `MERGE_HEAD` set and continue the ordinary cycle, which
commits the merge.

When every conflicted path was discernable, do not raise attention.
