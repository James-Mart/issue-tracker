# Delegation

Not a spawnable agent (no frontmatter). Cross-cutting skill-facing
delegation vocabulary. Callers **Read** this file from disk — a markdown
link alone is not enough.

Absolute path for this file (Read this exact path):

`/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-delegation.md`

## Channel detection

Before delegating, call `GetMcpTools` for the `custom-user-tools` server and
look for the `delegate` tool. Present means the **app channel**; absent means
the **IDE channel** (Cursor Task). Detection is that probe and nothing else —
no environment variable, no flag passed in the prompt, and no inferring the
host from surrounding context.

## App channel

Use `CallMcpTool` against server `custom-user-tools`:

- **`delegate`** — spawn or resume a nested agent. Arguments: `role`
  (spawnable `agents/<role>.md` name), `prompt`, and optional `resumeId`
  (existing nested agent id to re-enter). The app selects the model from the
  role's frontmatter pin; do not pass a model.
- **`delegations`** — return `{ root: { agentId }, delegations: [...] }`
  where `root.agentId` is this conversation's session root agent and
  `delegations` lists nested delegations most-recent-first (use when
  looking up a `resumeId`). When the conversation is unknown or has no
  root agent yet, `delegations` is empty and `root` is omitted.

## IDE channel

Spawn and resume via Cursor Task (`subagent_type`, `prompt`, `model`, resume).
Each named model is the pin its target agent carries. Pass it as Cursor Task
`model` when that slug is among those your Task tool advertises; when it is
not, pass no model at all — the pin travels with the agent definition and the
host applies it. Never substitute a different slug, and do not treat an
unavailable slug as a refusal (or as grounds for `needsAttention`).

## Missing spawn surface

When the IDE channel applies and the Cursor Task tool is also unavailable, do
not improvise a blanket inline run. Per beat:

- **Research** and **plan-polish checks** — absorb inline.
