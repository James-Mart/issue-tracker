# Code-quality — Diff review

Not a spawnable agent (no frontmatter). Loaded only when Task `noDiff` is
absent/false. Used by `issue-tracker-code-quality-validator`.

Absolute path for this file (Read this exact path):

`/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-code-quality-diff-review.md`

1. Inspect the current **uncommitted** working-tree diff for this Task.
2. Perform a deep code quality review for
    * introduced redundancy
    * poor abstraction, encapsulation, or modularity
    * non-idiomatic or outdated patterns
    * spaghetti code
    * succinctness/legibility issues
    * leftover patterns / dead code
3. Rethink how to structure / implement the changes to meaningfully improve
   code quality without impacting behavior. Be **ambitious** here about code
   structure. Do not merely identify local cleanup opportunities. Actively
   search for "code judo" moves: restructurings that preserve behavior while
   making the implementation dramatically simpler, smaller, more direct, and
   more elegant.
4. Prepare the comment body:
   - **Only actionable problems** as a concrete list.
   - Do **not** list things you judge correct or acceptable — the implementor
     treats anything unmentioned as fine.
   - If nothing actionable, a single line saying so.
   Then return to the parent **What you do** section (do **not** post the
   comment or stop from this file).
