# Code review — shared contract

Not a spawnable agent (no frontmatter). Referenced by the five
`issue-tracker-review-*` agents. Used by `issue-tracker-implementor`.

Spawnable agents **must** load this file from disk at bootstrap (absolute
path below) — a markdown link in the agent body is not enough; Cursor does
not inject linked files into the subagent prompt.

Absolute path for this file (Read this exact path):

`/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-code-review-base.md`

You read the uncommitted change and return findings. Do not edit the
workspace, write git, or write the tracker.

## CLI

**Read** `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-cli.md`.

**Read-only allowlist:** `summary` and `--help`.

## Bootstrap

On every entry, including `Mode: recheck`:

1. `issue summary <id>` for the Task. `<id>` is the id on the invoking
   prompt's `Issue:` line.
2. **Read**
   `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-workspace-gate.md`
   and follow it.
3. Use the summary `Workspace:` line as the cwd for **## Input**. That
   path is the Story worktree the implementor is working in.

## Input

The uncommitted change in that worktree:

- `git diff HEAD`
- Untracked files: every `??` path from `git status --porcelain`. Read
  the file. When the path is a directory, read the files under it.

Findings are about that change. `file` and `line` name a line in the
change when one line holds the finding. A read outside the change is
context. The duplication reviewer uses that context to search for a
helper, utility, or pattern the new code re-implements.

## Inputs (from invoking prompt)

- **Issue** — id and title of the Task
- **Mode** — omitted on the first entry. `recheck` includes **Fixed:**
  the finding ids the implementor fixed, comma-separated

## Output

Judge the Input against the concern section in your role file. Return
**only** a JSON array as the final reply — no prose wrapper, no Markdown
fences. An empty array means no findings. Each element:

```json
{
  "id": "<kebab-case slug, unique in this reviewer's session>",
  "file": "<workspace-relative path, or null>",
  "line": "<number, or null>",
  "concern": "<the concern key from your role file>",
  "finding": "<what is wrong>",
  "suggestion": "<the proposed change>"
}
```

`file` and `line` are JSON `null` when the finding has no file or no
single line — not the string `"null"`. `concern` is the concern key from
your role file, copied verbatim. A finding that is still present on a
later entry keeps its `id`. A finding the fix introduced takes a new
`id`.

## Recheck

When Mode is `recheck`, include each finding that remains unfixed.
Include each finding the fix introduced. Leave out an id listed under
Fixed when the current change no longer shows it. When nothing remains,
return `[]`.
