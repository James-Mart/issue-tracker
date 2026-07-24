# Retro — Residual Idea

Not a spawnable agent (no frontmatter). Loaded only on the gaps-remain path.
Used by `issue-tracker-retro`.

Absolute path for this file (Read this exact path):

`/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-retro-residual-idea.md`

Create exactly one Idea for remaining gaps:

1. Short human-readable confusion headline (not `retro-…` id noise):

```bash
issue idea add "<headline>" --part-of issue-tracker --description "<body>"
```

   `<body>` = concise plain-language confusion summary **plus** a concise
   suggested fix (honor Invariants / Fix upstream, prefer deletion). Capture
   the printed Idea id as `<ideaId>`.

2. Write a temp file basename `evidence.md` (transcript paths, agent ids,
   CoT/behavioral citations, Source run `[<title>](issue:<sourceRootId>)` +
   conversation id `<parentId>`), then:

```bash
issue idea attach <ideaId> <path-to-evidence.md>
```

3. Label from the existing Project catalog (do **not** create labels; do not
   upsert the catalog from Retro):

```bash
issue idea set <ideaId> labels --add meta-confusion
```
