# Finalize

Write the running draft accumulated during the relay loop (Flow step 3) to a
temp file `decision-summary.md` — one entry per decision (decision,
chosen answer, rationale; the distilled audit trail, **not** the raw
back-and-forth transcript). Run this after Flow step 4 (Retro) completes.

The seed Idea is archived once planning finishes — use the Bootstrap
`<issueId>`. Write a **single** combined audit trail onto that archived Idea
(one target), even when the Idea migrated into multiple roots. The
decision-summary attachment and standout-decisions comment land on that
Idea, not on the resulting roots — their provenance is the planner's
imperative `sourceIdea` write on each root (not part of finalize).

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
immediately. Also report the resulting plan root id(s) and where the
decision-summary report and standout-decisions comment landed on the archived
source Idea.
