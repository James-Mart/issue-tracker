# Verification store

Not a spawnable agent (no frontmatter). Cross-cutting skill/agent-facing
note. Callers **Read** this file from disk — a markdown link alone is not
enough.

Absolute path for this file (Read this exact path):

`/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-verification-store.md`

When the verification server is started by `agent_stack_start`, it reads the
live tracker store and refuses writes. The look role does not seed that store.
If the state to capture is not already there, the look fails.

When the verification server is not `agent_stack_start`, it uses its checkout's
store. The verifying agent seeds the fixture data the change needs, and that
server does not write the live store.
