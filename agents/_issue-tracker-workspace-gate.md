# Workspace gate

Not a spawnable agent (no frontmatter). Cross-cutting skill-facing gate
after `issue summary` has produced a Project section. Callers **Read** this
file from disk — a markdown link alone is not enough.

Absolute path for this file (Read this exact path):

`/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-workspace-gate.md`

Parameter: summary output already in context (do not re-fetch solely for
this gate).

1. Take `<projectId>` from the id token on `Project: <projectId> — <title>`.
2. If `Workspace:` / `workspace:` is absent, **stop and hand back to the user**
   to set it (`issue project set <projectId> workspace <path>`). Per SPEC §
   Project workspace: unset → escalate, never fall back.
