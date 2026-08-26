# Supporting-doc consult (shared)

Not a spawnable agent (no frontmatter). Parameter: `<key>` —
`vision` | `codingStandards` | `designSystem`.

Resolve supporting docs **only** via `supportingDocs` on the Project
(**consult-if-present**). No key or unreadable target → skip; never fail the
workflow.

Issues, attachments, and Project `supportingDocs` are located through the
`issue` CLI and this consult path — never discovered by Grep or Glob. The
tracker store is gitignored, so those search tools skip it; an empty search
is not absence. Reading an absolute path that `issue summary` already
resolved is that sanctioned channel — that is what this file's Algorithm
does for an `attachment:` ref. The ban is on finding tracker content by
search, not on the Read that follows.

Absolute path for this file (Read this exact path):

`/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-consult-supporting-doc.md`

Spawnable agents **must** read this file from disk when a bootstrap step
references it — a markdown link alone is not enough.

## Inputs

- `<key>` — which `supportingDocs` entry to consult
- **Summary output** — from the bootstrap `issue summary` run (already in
  context; do not re-fetch `issue project get` / `issue project view` solely
  for this consult)

## Algorithm

1. On the Project section of the summary, check `supportingDocs:` for
   `<key>=...`. Absent → skip.
2. Parse the ref for `<key>`:
   - `attachment:<name>` — under `Attachments:` on that Project section,
     find the line for `<name>`; Read using the absolute on-disk path after
     `—`.
   - `workspace:<path>` — Read the absolute path formed by joining Project
     `Workspace:` (from the summary) with `<path>`.
3. Unreadable or missing on disk → skip.

Use the doc for the caller's stated purpose (e.g. global product context when
`<key>` is `vision`).
