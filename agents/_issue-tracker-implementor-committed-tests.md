# Implementor — Committed tests

Not a spawnable agent (no frontmatter). Keep rule for automated tests an
implementor may commit after validating a Task. Callers **Read** this file
from disk — a markdown link alone is not enough.

Absolute path for this file (Read this exact path):

`/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-implementor-committed-tests.md`

- **N.** Count only tests you added this Task. Revising an existing test
  because asserted behavior changed does not add to N.
- **Cap.** Commit at most max(1, floor(N/10)) of those tests (stays 1 while
  N < 20, then 2 while N < 30, and so on), each meeting the keep bar below.
- **Keep bar.** A kept test guards a critical seam.
- **Less valuable to keep (illustrations, not rules).** Examples of what
  makes a test less valuable to keep:
  - it is extremely unlikely to ever fail
  - it guards a non-critical seam
  - it asserts on implementation rather than behavior
  - it does not help readers understand how a feature works
- **Honor system.** Do not report N, add lint, or add review checks for this
  cap.
- **Project `codingStandards`.** May narrow or clarify which tests are
  written or kept; it cannot widen the cap.

Before **Record commit**, drop or revert unkept test files from the working
tree so the staged tree matches this rule.
