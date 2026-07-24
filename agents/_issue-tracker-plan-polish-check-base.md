# Plan-polish check agent — shared contract

Not a spawnable agent (no frontmatter). Referenced by the five
`issue-tracker-plan-*` check agents and by `issue-tracker-plan-polish`
Bootstrap (work-root kind gates). Used by `issue-tracker-plan-polish`.

Spawnable agents **must** load this file from disk at bootstrap (absolute
path below) — a markdown link in the agent body is not enough; Cursor does
not inject linked files into the subagent prompt.

Absolute path for this file (Read this exact path):

`/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-plan-polish-check-base.md`

You only read the work-root tree and return findings. Do not write the
tracker or edit workspace source.

## CLI

**Read** `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-cli.md`.

**Read-only allowlist:** `summary`, `tree`, `list`,
`<kind> get`, `<kind> view`, `<kind> attachments`, and `--help`.

Load issue specs via `issue <kind> view <id>` (and `<kind> get` for scalars).

## Bootstrap

1. `issue summary <rootId>` for Project → work-root context (and
   `Workspace:`). Take `<projectId>` from the id token on
   `Project: <projectId> — <title>`.
2. **Work-root kind gates** (single source of truth for polish roots —
   coordinator and check agents both apply this block):
   - **Epic** — set `<rootKind>` = `epic`; proceed.
   - **Story** — confirm it is **project-level** (`issue story get <rootId>
     partOf` equals `<projectId>`; refuse Epic-child Stories — they are not
     polish roots). Set `<rootKind>` = `story`.
   - Any other kind → refuse.
   On refuse: check agents return `[]` and stop; the coordinator stops and
   hands back to the user (does not spawn checks).
3. **Read**
   `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-consult-supporting-doc.md`.
   Consult `vision` per that file using the step-1 summary output.
4. `issue tree <rootId>` for the Story/Task outline.
5. `issue <kind> view <id>` on the work root and every Story/Task you review
   (plus any extra `<kind> get` / sibling reads your agent file calls for).

## Inputs (from invoking prompt)

- **Work root** id (+ title) — Epic or project-level Story
- Return findings **only** in this Cursor Task result to the parent (never
  `issue <kind> comment` or other writes).

## Output

Return **only** a JSON array (empty `[]` if clean) as the Cursor Task result
body — no prose wrapper, no Markdown fences. Each element:

```json
{
  "severity": "error",
  "issueId": "<epic|story|task id>",
  "problem": "one sentence"
}
```

- `severity`: `"error"` \| `"warning"` (required)
- `issueId`: Epic / Story / Task id (required)
- `problem`: one sentence (required)

Finish and stop. No tracker writes.
