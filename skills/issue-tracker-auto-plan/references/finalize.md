# Finalize

Write the running draft accumulated during the relay loop (Flow step 3) to a
temp file `decision-summary.md` — one entry per decision (decision,
chosen answer, rationale; the distilled audit trail, **not** the raw
back-and-forth transcript). Run this after Flow step 4 (Retro) completes.

The seed Idea is archived once planning finishes — after Yes when polish
finishes, after Not now by the planner — use the Bootstrap `<issueId>`.
Write a **single** combined audit trail onto that archived Idea (one
target). The decision-summary attachment and standout-decisions comment land
on that Idea, not on the resulting root — its provenance is the decomposer's
imperative `sourceIdea` write (not part of finalize).

- **Target list:** one entry — kind `idea`, id `<issueId>`.

### For each target

1. **Decision-summary report.**

   ```bash
   issue attach <id> <path-to-decision-summary.md>
   ```

2. **Standout-decisions comment.** Flag any standout / uncertain decisions for
   the human to double-check (empty of standouts → say so briefly):

   ```bash
   issue comment <id> --role stakeholder --body "<body>"
   ```

### Report to the invoking user

On success, print the full `decision-summary.md` body to the invoking user —
not only where it was attached — so they can review each decision and iterate
immediately. Also report the planner's final message (the resulting root
id after Yes, the outline id after Not now) and where the
decision-summary report and standout-decisions comment landed on the archived
source Idea.
