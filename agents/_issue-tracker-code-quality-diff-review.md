# Code-quality — Diff review

Not a spawnable agent (no frontmatter). Loaded only when Task `noDiff` is
absent/false. Used by `issue-tracker-code-quality-validator`.

Absolute path for this file (Read this exact path):

`/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-code-quality-diff-review.md`

1. Re-read the Task's recorded commit range on every entry (including
   resumes). In the Project workspace, run `issue task get <taskId> commits`
   (JSON array, oldest first). Set `<first>` to the oldest element and
   `<last>` to the newest, then inspect the patch with
   `git diff <first>^..<last>` and read changed files directly from that
   range.
2. Perform a deep code quality review for
    * introduced redundancy
    * poor abstraction, encapsulation, or modularity
    * non-idiomatic or outdated patterns
    * spaghetti code
    * succinctness/legibility issues
    * leftover patterns / dead code
    * an untracked file that looks generated — the implementor deletes it
      or adds an ignore rule
3. Rethink how to structure / implement the changes to meaningfully improve
   code quality without impacting behavior. Be **ambitious** here about code
   structure. Do not merely identify local cleanup opportunities. Actively
   search for "code judo" moves: restructurings that preserve behavior while
   making the implementation dramatically simpler, smaller, more direct, and
   more elegant.
4. Prepare findings for Outcome:
   - **Only actionable problems** — one finding per actionable item.
   - Each finding body carries the judgement only; record the line location
     separately for Outcome anchor flags (`--path`, `--side new`, `--line`,
     optional `--start-line`, `--commit` set to `<last>` from step 1).
   - A finding with no single location — a missing file, an absent test — has
     no anchor; Outcome posts it unanchored.
   - A finding that continues a point you already raised carries that thread
     root's comment id for `--reply-to` instead of anchor flags; do not
     prepare a second thread on the same lines.
   - Do **not** list things you judge correct or acceptable — the implementor
     treats anything unmentioned as fine.
   - If nothing actionable, a single clean-pass line (no findings list).
   Then return to the parent **What you do** section (do **not** post comments
   or stop from this file).
