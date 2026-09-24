# Retro — Residual Idea

Not a spawnable agent (no frontmatter). Loaded only on the gaps-remain path.
Used by `issue-tracker-retro`.

Absolute path for this file (Read this exact path):

`/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-retro-residual-idea.md`

Each remaining gap is already judged in **## Flow**: matching an open Idea,
matching an archived Idea, or unmatched. Evidence for any path is the
upstream-cause diagnosis — what the agent read, what it did, and where it
went wrong — plus transcript paths, agent ids, CoT/behavioral citations,
Source run `[<title>](issue:<sourceRootId>)` + conversation id `<parentId>`.

## Matches an open Idea

Write that gap's evidence to a temp file named `evidence-<sourceRootId>.md`,
then:

```bash
issue idea attach <matchedIdeaId> <path>
```

That gap gets no new Idea.

## Matches an archived Idea

The earlier fix did not hold. Treat the gap as unmatched. The new Idea's
description says it recurs after `issue:<archivedIdeaId>`.

## Unmatched

Fold every unmatched gap, including each archived match, into one Idea. When
every gap matched an open Idea, this section creates nothing.

1. Short human-readable confusion headline (not `retro-…` id noise):

```bash
issue idea add "<headline>" --part-of issue-tracker --description "<body>"
```

   `<body>` = concise plain-language statement of the problem and its observed
   impact on the run. For a gap that matched an archived Idea, `<body>` says
   it recurs after `issue:<archivedIdeaId>`. Capture the printed Idea id as
   `<ideaId>`.

2. Write a temp file basename `evidence.md`, then:

```bash
issue idea attach <ideaId> <path-to-evidence.md>
```

3. Label from the existing Project catalog (do **not** create labels; do not
   upsert the catalog from Retro):

```bash
issue idea set <ideaId> labels --add meta-confusion
```
