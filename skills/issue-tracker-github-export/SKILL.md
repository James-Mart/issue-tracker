---
name: issue-tracker-github-export
disable-model-invocation: true
description: >-
  Rewrite a root-level Epic or project-level Story into GitHub-shaped
  export drafts. Use when an export session runs a GitHub-export rewrite
  of a tracker root.
---

# Issue Tracker — GitHub export rewrite

Rewrite one root — an unarchived Epic or project-level Story — into
GitHub-shaped markdown drafts on that root. The tracker tree is the source
of the first rewrite. Nothing is posted to GitHub.

**Read** `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-cli.md`.

**Read** `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-ikigai.md`.

Use the default issues dir (do not set `ISSUES_DIR`).

## Argument

The root issue id from the export session message.

## First run

Do not pause for questions. Write the full draft set once, or stop when a
step fails.

1. Print the draft set from the plugin app directory:

```bash
cd /root/.cursor/plugins/local/issue-tracker/app && npx tsx scripts/print-export-drafts.ts <rootId>
```

That command reads the root through the issue view service and prints
`{ files: { name, content }[] }`. A nonzero exit is a failure: report stderr
and stop.

2. PUT that JSON to the tracker API. Pipe the script stdout as the body.
   The API listens on port `PORT`, or `8061` when `PORT` is unset:

```bash
curl -sS -f -X PUT "http://127.0.0.1:${PORT:-8061}/api/issues/<rootId>/export-drafts" \
  -H "content-type: application/json" \
  --data-binary @-
```

A failed PUT is a failure: report the response and stop. Do not call
`PUT .../attachments/:name`. Do not call GitHub. Do not add labels or wrap
the mapped body in a template.

## Mapping

The script's files are the mapping.

- Each Story is one file `github-export-<storyId>.md`. YAML frontmatter
  `title` is the Story title. After the frontmatter, the Story description
  is the first prose, then each Task in tracker order as `## <task title>`
  followed by that Task's description.
- An Epic is one file `github-export-<epicId>.md`. Frontmatter `title` is
  the Epic title. The body is the Epic description, then a GitHub tasklist
  of contained Story titles in tracker order (`- [ ] <title>`), plus one
  Story file per contained Story.
- Tracker order is root Stories by stored `order`, each followed by Stories
  stacked on it, and Tasks under a Story by stored `order`. Contained
  Stories and Tasks include archived ones.
- Copy description and that child structure only — not comments, blockers,
  status, assignee, or other attachments.

## Later updates

When a later message changes one or more drafts, PUT
`/api/issues/<rootId>/export-drafts` again with the full current set: every
`github-export-*.md`, including files this message did not change. Omitting
a reserved name deletes it. List names with `issue attachments <rootId>`.
Read each reserved file with
`GET http://127.0.0.1:${PORT:-8061}/api/issues/<rootId>/attachments/<name>`.
Do not call `PUT .../attachments/:name`.
