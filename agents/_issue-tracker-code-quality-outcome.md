# Code-quality — Outcome

Not a spawnable agent (no frontmatter). Loaded after No-diff or Diff review
prepares findings. Used by `issue-tracker-code-quality-validator`.

Absolute path for this file (Read this exact path):

`/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-code-quality-outcome.md`

Required exit: one shell that posts every finding comment **and** sets terminal
`qa` (and `needsAttention` on the third strike). Posting comments without
the terminal `qa` write is **not** a valid stop.

Choose the terminal `qa` value, then run **one** chained shell. Use a HEREDOC
for each comment body. Set `<head>` to the newest sha in the Task's recorded
commit series (the head the review was against).

**Clean** (nothing actionable) — one unanchored comment:

```bash
issue task comment <taskId> --role code-quality-validator --body "$(cat <<'EOF'
<body prepared above>
EOF
)" && issue task set <taskId> qa passed && issue task set <taskId> status done
```

**Actionable findings** — count how many times **you** have already set
`qa changes-requested` in **this** Cursor Task conversation (including the
outcome you are about to write). Count from your own resumed history / prior
turns in this session — there is no stored counter field; the coordinator
does not count.

Post **each** finding as its own comment in the same chained shell. The body
carries the judgement only — do not restate file names or line numbers there;
the anchor flags hold the location.

- A finding with a line location:

```bash
issue task comment <taskId> --role code-quality-validator --body "$(cat <<'EOF'
<judgement only>
EOF
)" --path <repo-relative path> --side new --line <n> --commit <head>
```

- A range uses `--start-line`:

```bash
issue task comment <taskId> --role code-quality-validator --body "$(cat <<'EOF'
<judgement only>
EOF
)" --path <repo-relative path> --side new --line <n> --start-line <n> --commit <head>
```

- A finding with no single location — a missing file, an absent test — stays
  unanchored (no anchor flags).

Chain every comment with `&&`, then the terminal `qa` write:

- **1st or 2nd** `changes-requested`:

```bash
issue task comment <taskId> --role code-quality-validator --body "$(cat <<'EOF'
<judgement only>
EOF
)" --path <path> --side new --line <n> --commit <head> && \
issue task comment <taskId> --role code-quality-validator --body "$(cat <<'EOF'
<judgement only>
EOF
)" --path <path> --side new --line <n> --start-line <n> --commit <head> && \
issue task comment <taskId> --role code-quality-validator --body "$(cat <<'EOF'
<judgement only — no anchor>
EOF
)" && \
issue task set <taskId> qa changes-requested
```

- **3rd** `changes-requested` (include a short concrete summary in the
  reason). Do **not** leave a normal revise gate for the coordinator to loop
  again:

```bash
issue task comment <taskId> --role code-quality-validator --body "$(cat <<'EOF'
<judgement only>
EOF
)" --path <path> --side new --line <n> --commit <head> && \
issue task set <taskId> qa changes-requested && issue task set <taskId> needsAttention true --reason "code-quality: 3rd changes-requested in this QA session — <short summary>"
```

Never edit workspace source. Finish and stop.
