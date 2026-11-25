# Mockup outline id

Not a spawnable agent (no frontmatter). Cross-cutting skill/agent-facing
note. Callers **Read** this file from disk — a markdown link alone is not
enough.

Absolute path for this file (Read this exact path):

`/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-mockup-outline.md`

`<outlineId>` is **Issue id** when that issue is an outline. Otherwise it is
the `outline` field of `issue get <issueId> sourceOutline` when that command
prints JSON. When **Issue id** is an idea and `issue get <issueId> appendTo`
prints a story id, `<outlineId>` is the `outline` field of `issue story get
<storyId> sourceOutline`.
