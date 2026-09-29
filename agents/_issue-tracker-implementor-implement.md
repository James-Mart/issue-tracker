# Implementor — Implement mode

Not a spawnable agent (no frontmatter). Loaded only when Mode is
`implement`. Used by the implementor family wrappers.

Absolute path for this file (Read this exact path):

`/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-implementor-implement.md`

1. Implement what the Task's `description.md` specifies. Also do anything
   that obviously belongs with it for internal consistency.
2. Edit the working tree; **do not commit**. Do not stage except to clear
   unmerged merge paths (below). When you start a merge, run
   `git merge --no-commit <ref>` — not a default `git merge` that may
   auto-commit. If the merge has conflicts, resolve them, `git add` those
   paths, and still do not commit — leave `MERGE_HEAD` set with no unmerged
   paths at handoff. For a task titled `Update from merge base`, follow the
   task description: discernable paths are staged, undiscernable paths stay
   unmerged, and that state raises attention and stops before record-commit.
   Other tasks still hand off with no unmerged paths.
3. **Self-check.** Choose the checks that show the outcomes the Task states
   hold, and run them. Unit-suite runs follow `codingStandards` § Unit
   suite. For build, runtime, and browser checks, **Read**
   `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-consult-supporting-doc.md`
   and consult `verification` per that file using the bootstrap summary
   output. A `### Verify` section in the Task is context for choosing checks.
   When this Task builds on a prior Task's tests, keep the self-check focused
   on this Task's surface — do not re-run the prior Task's full matrix by
   default.
   When the Task appears UI-related (the bootstrap `designSystem` judgment),
   **Read**
   `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-ui-look.md`
   and follow it as part of this self-check.
   Record the include's three evidence fields
   on one `issue task comment <id> --role implementor` (the comment for this
   look — do not add a second look-only comment). If the look failed, then
   `issue task set <id> needsAttention true --reason "..."` and stop. Passing
   checks do not waive a failed look.
   A completed look with a visible product problem is fixed in this implement
   pass — it is not a reason to skip the look.
   The self-check is done when every check you chose passes and, on a
   UI-related Task, the look passed.
4. **Intentional no-op.** If correctly satisfying the spec means there are **no
   source-controlled file changes**, signal it explicitly with
   `issue task set <id> noDiff true`, then go to step 8.
   A real edit that only touches non-source-controlled files (e.g. a Project
   attachment under the gitignored `issues/` store) still warrants `noDiff true`.
   That structured flag plus the step 8 summary comment is what Story review
   reads — an empty tree on its own is **not** a completion signal, so never
   rely on it alone.
5. If blocked, raise `issue task set <id> needsAttention true --reason "..."`
   and stop. This role's status writes are Bootstrap's entry `in-progress`
   and step 9's terminal `done`.
6. **Review.** Reviewers read the uncommitted change and return a JSON array
   of findings. You have final authority over your code.
   1. Delegate the **Review** stub in parallel, one delegation per reviewer
      role. Include `issue-tracker-review-design-system` only when the Task
      is UI-related (the bootstrap `designSystem` judgment). Keep each returned agent id.
   2. For each finding, fix it or decline it with a reason.
   3. Re-enter each reviewer with at least one finding you fixed, using the
      **Review (recheck)** stub. Handle each reply as in step 6.2. Repeat
      until a round fixes nothing.
   4. Re-run step 3's checks. Re-run its UI look only when the Task
      is UI-related and the review fixes changed at least one of the paths
      that made it so; that look's three evidence fields go in the step 8
      comment.
7. **Read**
   `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-implementor-record-commit-beat.md`
   and follow it.
8. Post one summary comment:
   `issue task comment <id> --role implementor --body "..."`. It lists each
   finding you fixed (reviewer, finding) and each finding you declined
   (reviewer, finding, reason). For a `noDiff` Task, it says what was done,
   what was found, and why no source-controlled change is the right outcome.
9. `issue task set <id> status done`.
