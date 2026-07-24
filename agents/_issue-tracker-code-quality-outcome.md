# Code-quality — Outcome

Not a spawnable agent (no frontmatter). Loaded after No-diff or Diff review
prepares the comment body. Used by `issue-tracker-code-quality-validator`.

Absolute path for this file (Read this exact path):

`/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-code-quality-outcome.md`

Required exit: one shell that posts the comment **and** sets terminal `qa`
(and `needsAttention` on the third strike). Posting a comment alone is **not**
a valid stop.

Choose the terminal `qa` value, then run **one** chained shell. Use a HEREDOC
for the comment body:

**Clean** (nothing actionable):

```bash
issue task comment <taskId> --role <comment-role> --body "$(cat <<'EOF'
<body prepared above>
EOF
)" && issue task set <taskId> qa passed
```

**Actionable findings** — count how many times **you** have already set
`qa changes-requested` in **this** Cursor Task conversation (including the
outcome you are about to write). Count from your own resumed history / prior
turns in this session — there is no stored counter field; the coordinator
does not count.

- **1st or 2nd** `changes-requested`:

```bash
issue task comment <taskId> --role <comment-role> --body "$(cat <<'EOF'
<body prepared above>
EOF
)" && issue task set <taskId> qa changes-requested
```

- **3rd** `changes-requested` (include a short concrete summary in the
  reason). Do **not** leave a normal revise gate for the coordinator to loop
  again:

```bash
issue task comment <taskId> --role <comment-role> --body "$(cat <<'EOF'
<body prepared above>
EOF
)" && issue task set <taskId> qa changes-requested && issue task set <taskId> needsAttention true --reason "code-quality: 3rd changes-requested in this QA session — <short summary>"
```

Never edit workspace source. Finish and stop.
