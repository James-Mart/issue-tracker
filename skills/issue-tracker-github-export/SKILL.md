---
name: issue-tracker-github-export
disable-model-invocation: true
description: >-
  Rewrite a root-level Epic or project-level Story into publishing-prose
  GitHub export drafts. Use when an export session runs a GitHub-export rewrite
  of a tracker root.
---

# Issue Tracker — GitHub export rewrite

Rewrite one root — an unarchived Epic or project-level Story — into
publishing-prose drafts on that root. The reader is an implementer who already
knows this project. Tracker issues stay the detailed plan agents use. Each
draft file keeps a YAML `title`; the body is the GitHub issue markdown.
Nothing is posted to GitHub. The work merges to trunk.

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

A nonzero exit is a failure: report stderr and stop.

That JSON is the file set. Each `name` is `github-export-<id>.md`. The file
`github-export-<rootId>.md` is the root. When the root is an Epic, the
remaining files are its Stories, in tracker order. When the root is a Story,
that one file is the Story. File order is tracker order: root Stories by
stored order, each followed by Stories stacked on it. Each file's `content`
holds the tracker title and description text the writer reads. A Story file's
content holds that Story's description, then each Task in tracker order with
its title and description. An Epic file's content holds the Epic description,
then the contained Story titles.

2. Read landing relationships from the tracker. For each Story in the file
   set, run `issue story get <id> stackedOn`. When the root is an Epic, run
   `issue epic get <rootId> blockedBy`.

3. Write each file in the publishing voice below, using the script's names
   and order, before the single PUT. The stored `title` and body are this
   prose.

4. PUT the authored `{ files: { name, content }[] }` once. The request body
   is that JSON. The API listens on port `PORT`, or `8061` when `PORT` is
   unset:

```bash
curl -sS -f -X PUT "http://127.0.0.1:${PORT:-8061}/api/issues/<rootId>/export-drafts" \
  -H "content-type: application/json" \
  --data-binary @-
```

A failed PUT is a failure: report the response and stop. Do not call
`PUT .../attachments/:name`. Do not call GitHub.

## Publishing prose

The prose uses the names that reader already uses for the areas in the change
and for the operations those areas perform. It leads with the situation, then
the behavior. The YAML `title` is a short name of the outcome.

A Story body is a few paragraphs, separated by a blank line, covering the
problem, the outcome, the area of the code, and the object shapes. That
Story's tasks are folded into those paragraphs. The paragraphs state an
outcome and object shapes an implementor would still reach.

When a Story has to land after another, its prose names the piece it follows
in ordinary language. A Story whose `stackedOn` is set lands after that
Story. A Story with no `stackedOn`, in an Epic whose `blockedBy` lists
earlier Epics, lands after that earlier work. When the piece it follows is in
this export's file set, the name is the published title being written for it.
When that piece is outside the file set, the name is that issue's tracker
title.

An Epic body is those paragraphs, then a checklist of the rewritten Story
titles in landing order (`- [ ] <published title>`). Each Story stays its own
file. Landing order is the script's file order.

## Later updates

When a follow-up message changes the substance of one or more drafts, list
names with `issue attachments <rootId>`. Read each reserved file with
`GET http://127.0.0.1:${PORT:-8061}/api/issues/<rootId>/attachments/<name>`.
Rewrite the changed drafts in the publishing voice above. PUT
`/api/issues/<rootId>/export-drafts` again with the full current set: every
`github-export-*.md`, including files this message did not change. Omitting
a reserved name deletes it. Do not call `PUT .../attachments/:name`.
