# Implementor — Committed tests

Not a spawnable agent (no frontmatter). Rule for which automated tests an
implementor's change carries. Callers **Read** this file from disk — a
markdown link alone is not enough.

Absolute path for this file (Read this exact path):

`/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-implementor-committed-tests.md`

A new test is committed only when tests have been asked for.

- **Asked for.** You judge whether tests have been asked for. A Task
  description that says nothing about tests has not asked. A review comment
  or review finding that says to add tests has asked. Every test that was
  asked for may be committed.
- **New test.** A behavior the existing tests do not already assert is a new
  test, including when its assertion is added to a file that already holds
  tests.
- **Updated test.** An existing test may be updated so its asserted outcome
  matches the product behavior this Task changes, and that update may be
  committed.
- **Kinds.** The rule covers unit, integration, end-to-end, and live tests.
- **Support files.** A helper, fixture, or snapshot used only by a test this
  rule removes is removed with that test. One that an existing test or an asked-for
  test still uses may be committed.
- **Project `codingStandards`.** May narrow or clarify which tests are
  written or kept, including forbidding committed tests. It cannot authorize
  a new test that has not been asked for.

Remove every new test that has not been asked for from the working tree,
together with the support files only it uses. This rule is done when no
such test remains in the working tree.
