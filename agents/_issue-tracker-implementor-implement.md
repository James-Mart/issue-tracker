# Implementor — Implement mode

Not a spawnable agent (no frontmatter). Loaded only when Mode is
`implement`. Used by the implementor family wrappers.

Absolute path for this file (Read this exact path):

`/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-implementor-implement.md`

1. Implement what the Task's `description.md` specifies. Also do anything
   that obviously belongs with it for internal consistency.
2. Edit the working tree; **do not commit or stage**.
3. Verify as that description requires (tests, build, etc.). When this
   Task builds on a prior Task's tests, keep verification focused on this
   Task's surface — do not re-run the prior Task's full matrix by default.
   When the Task appears UI-related (same judgment as the `designSystem`
   consult — Task prose and changed paths), also do a **best-effort** UI check
   the way a human implementer would: with `npm run dev` already running, run
   `cd app && npm run screenshots -- <path-or-dialog>` and read the PNGs under
   the output dir (default `/tmp/issue-tracker-screenshots`) to confirm the
   Task's visible behavior. Use Cursor browser MCP tools only for interaction
   needed to reach a state (not for screenshot capture). If capture fails or is
   unavailable, note that in an `issue task comment <id> --role implementor`
   and continue with the Task's non-screenshot Verify steps — do not raise
   `needsAttention` solely because capture failed. This UI check never weakens
   the hard gates (tests/build) the Task already requires.
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
