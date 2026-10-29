# CLI

Not a spawnable agent (no frontmatter). Cross-cutting skill/agent-facing
CLI preamble. Callers **Read** this file from disk — a markdown link alone
is not enough.

Absolute path for this file (Read this exact path):

`/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-cli.md`

Do not set `ISSUES_DIR`.

Use `issue_read` for tracker reads. If unavailable, use the `issue` binary.

Use `git_read` for Git inspection. If unavailable, use Git commands.

Consult tool schemas and command `--help` for supported operations.

Glossary: plugin `SPEC.md`.

Cross-cutting CLI invariants:
`/root/.cursor/plugins/local/issue-tracker/SPEC.md#cli-invariants`.
