# Verification store

Not a spawnable agent (no frontmatter). Cross-cutting skill/agent-facing
note. Callers **Read** this file from disk — a markdown link alone is not
enough.

Absolute path for this file (Read this exact path):

`/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-verification-store.md`

Story outcomes are established on the stack `agent_stack_start` boots
(`AGENT_STACK_BASE_URL`). The human's running tracker is a different process and
is not that stack. A human report of product behavior is not evidence for a
check on the Story branch.

Seed store state with playbook **May** on `AGENT_STACK_BASE_URL`. `issue` in the
agent shell hits the live store; the Story-scoped write there is `issue attach`.
Fresh guest copy: `agent_stack_stop`, then `agent_stack_start`.