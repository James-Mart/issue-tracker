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
  (spawnable `agents/<role>.md` name), `prompt`, optional `resumeId`
  (existing nested agent id to re-enter), and optional `issueId` (tracker
  issue this run is being spawned for). The app selects the model from the
  role's frontmatter pin; do not pass a model. Returns `ok: true` with
  `agentId` and `reply` on success; `ok: false` with `failureClass`,
  `isRetryable`, `message`, and `agentId` on a runtime failure. Caller errors
  still throw. On `failureClass`: `auth` — nothing; the app is already
  recovering and the turn is about to cancel; `cancelled` — report the
  decision, do not retry; `stalled-before-first-token` — retryable; re-issue
  the delegation; `transport-exhausted` — the upstream already exhausted ten
  streaming attempts, so an immediate re-issue is unlikely to help; whether to
  try at all is the caller's judgment rather than something the runtime
  settles; `agent-failed` — the nested agent's conclusion; retry or escalate
  per judgment.
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
