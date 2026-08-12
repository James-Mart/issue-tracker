# Vision doc quality bar

Every doc `issue-tracker-vision-docs` writes meets this bar — main vision and
subsystem doc alike.

## What a vision doc is

The idealized answer to "what is this?": the pitch, the value proposition, the
features that make the thing worth having — including the parts nobody has
built yet. A reader arrives knowing what the project or surface is for within a
couple of minutes.

Write it as product prose, close to marketing copy. Architecture, schemas, file
layouts, sequencing, and coding standards belong in other docs; a sentence that
only lands for someone reading the code does not belong here.

## Required sections

- `## Mission` — one short paragraph addressed to an agent about to do work
  here: what that work contributes to, distilled from the rest of the doc
  rather than describing the product. `issue summary` surfaces the main
  vision's Mission on the Project section.
- `## Personas` — who this doc serves, drawn from the Project `personas`
  catalog. One entry per persona, names matching the catalog exactly:

  ```
  - <catalog name> — <what this doc's subject gives them>
  ```

Everything else is free-form: use whatever headings carry the pitch.

## Subsystem reference (main vision only)

The main vision indexes subsystem vision docs under `## Subsystem reference`.
Preserve existing entries when revising.

```
- <subsystem name> — attachment:<name> — <one-line scope>
- <subsystem name> — attachment:<name> — <one-line scope> — personas: <name>, <name>
```

The trailing `— personas: …` says which personas that subsystem serves, and
appears only when they differ from the main vision's `## Personas`. A subsystem
serving the same personas carries no suffix.

## Anti-patterns

- **`## Non-goals`** — a vision doc encodes positive goals. What the project
  declines today can become a goal tomorrow without contradicting the vision.
  Drop the section when revising a doc that has one.
- **Too low-level** — implementation detail, API shapes, or ordering of work
  standing in for the pitch.
- **A subsystem doc restating the main vision** — say what is true of that
  surface and let the main vision carry the rest.
- **Personas described in prose instead of named from the catalog** — a reader
  cannot tell which audience a surface is for when the names drift.
