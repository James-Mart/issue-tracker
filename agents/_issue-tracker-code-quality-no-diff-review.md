# Code-quality — No-diff review

Not a spawnable agent (no frontmatter). Loaded only when Task `noDiff` is
true. Used by `issue-tracker-code-quality-validator`.

Absolute path for this file (Read this exact path):

`/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-code-quality-no-diff-review.md`

The Task intentionally lands no source-controlled changes, so there is nothing
to code-review. Instead:

1. Confirm the working tree is actually clean (`git status` in the workspace). A
   dirty tree with `noDiff` set is a contradiction — treat it as actionable.
   A clean tree after edits that only touched non-source-controlled files is
   consistent with `noDiff`, not a contradiction.
2. Confirm the implementor left a rationale: `issue task view <taskId> --chat` must
   contain an implementor comment tying the empty source-controlled diff to the
   spec. A flag set with no rationale is actionable.
3. Judge that rationale against the Task spec — is "no source-controlled
   changes" actually correct here? A weak or wrong rationale, or a spec that
   plainly demands source-controlled changes, is actionable. Do not treat
   `noDiff` as "nothing was done" when a non-source-controlled file was edited.
4. Prepare the comment body: list any actionable problems from above as a
   concrete list, or — if the no-op is justified — a single line approving it.
   Never edit files or the `noDiff` flag. Then return to the parent **What you
   do** section (do **not** post the comment or stop from this file).
