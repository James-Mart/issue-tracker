# Resolve Project (when no id)

Not a spawnable agent (no frontmatter). Cross-cutting skill-facing picker
when the Argument did not supply a Project / work-root id. Callers **Read**
this file from disk — a markdown link alone is not enough.

Absolute path for this file (Read this exact path):

`/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-resolve-project.md`

1. Run `issue tree` (no-arg: all projects).
2. Resolve `<projectId>` from the `project <id>` lines:
   - If it prints `no projects`, **stop and hand back to the user**.
   - If it shows more than one project, show the user the id/title list and
     ask which project.
   - If it shows exactly one project, use that project's id.

Then continue with the caller's next Argument step (typically
`issue tree <projectId>` and ask which work root / offer eligible ids).
