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
   paths at handoff.
3. Verify as that description requires (tests, build, etc.). When this
   Task builds on a prior Task's tests, keep verification focused on this
   Task's surface — do not re-run the prior Task's full matrix by default.
   When the Task appears UI-related (same judgment as the `designSystem`
   consult — Task prose and changed paths), **Read**
   `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-ui-look.md`
   and follow it as part of Verify. Record the include's three evidence fields
   on one `issue task comment <id> --role implementor` (the Verify comment for
   this look — do not add a second look-only comment). If the look failed, then
   `issue task set <id> needsAttention true --reason "..."` and stop. Passing
   tests or build does not waive a failed look; tests and build stay required.
   A completed look with a visible product problem is fixed in this implement
   pass — it is not a reason to skip the look.
4. **Intentional no-op.** If correctly satisfying the spec means there are **no
   source-controlled file changes**, signal it explicitly:
   `issue task set <id> noDiff true`, then `issue task comment <id> --role
   implementor --body "..."` explaining why no diff is the right outcome.
   A real edit that only touches non-source-controlled files (e.g. a Project
   attachment under the gitignored `issues/` store) still warrants `noDiff true`
   with that explanatory comment. That structured flag plus the chat rationale
   is how the empty source-controlled diff is judged and finalized downstream —
   an empty tree on its own is **not** a completion signal, so never rely on it
   alone.
5. If blocked, raise `issue task set <id> needsAttention true --reason "..."`
   and stop. Otherwise stop with the tree uncommitted. Git sets Task
   `status done` on finish-commit; this role's only status writes are
   Bootstrap's entry `in-progress` / `fixing`.
