# Supporting-doc consult (shared)

Not a spawnable agent (no frontmatter). Parameter: `<key>` —
`vision` | `codingStandards` | `designSystem`.

Resolve supporting docs **only** via `supportingDocs` on the Project
(**consult-if-present**). No key or unreadable target → skip; never fail the
workflow. No ad-hoc path scans.

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
