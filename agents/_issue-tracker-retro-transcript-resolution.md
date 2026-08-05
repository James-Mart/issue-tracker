# Retro — Transcript resolution

Not a spawnable agent (no frontmatter). Loaded when resolving the invoking
session's transcript mine set. Used by `issue-tracker-retro`.

Absolute path for this file (Read this exact path):

`/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-retro-transcript-resolution.md`

The **session mine set** is the session root's transcript plus the transcript
of every agent nested under it, at any depth. `$CURSOR_CONVERSATION_ID` names
one participant in that session — never assume it is the session root.

Layout: an agent that spawned subagents gets a top-level
`$AGENT_TRANSCRIPTS/<id>/` directory holding one `subagents/<child>.jsonl` per
child. That directory may also hold a self-named `<id>.jsonl` copy, which says
nothing about whether something nests `<id>`.

## Channel

**Read**
`/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-delegation.md`
and detect the channel per its **## Channel detection**.

## App channel — seeds from `delegations`

Call `delegations` per that file's **## App channel**. `root` omitted →
escalate per Escalation. Otherwise `<rootId> = root.agentId`, and the seed ids
are `<rootId>` plus every `agentId` in `delegations`, deduplicated — a resumed
agent is listed once per re-entry. App-channel delegations are not recorded
under any `subagents/` directory, so that list is the only record of them.

## IDE channel — walk to the outermost conversation

Set `currentId = $CURSOR_CONVERSATION_ID` and an empty `visited` set of
directories; loop:

- Find matches for `$AGENT_TRANSCRIPTS/*/subagents/<currentId>.jsonl`.
- More than one match → escalate per Escalation — do not pick a winner.
- One match → `candidate` = the directory containing that `subagents/`. When
  `candidate` is already in `visited`, escalate per Escalation (cycle).
  Otherwise add `candidate` to `visited`, set
  `currentId = basename(candidate)`, and continue.
- Zero matches → `<rootId> = currentId`; stop. Nothing nests `currentId`, so
  it is the outermost conversation.

The single seed id is `<rootId>`; the expansion below reaches every directory
the walk passed through, and their subagents.

## Expand to the session mine set

Start the mine set from the channel's seed ids. For every id `<id>` in the
set, add every `<sub>` that has
`$AGENT_TRANSCRIPTS/<id>/subagents/<sub>.jsonl`. Repeat until the set stops
growing, so the descent follows the nesting to any depth.

Mine one file per id in the set. For `<id>` the candidates are
`$AGENT_TRANSCRIPTS/<id>/<id>.jsonl` and, for the `<parent>` that nests it,
`$AGENT_TRANSCRIPTS/<parent>/subagents/<id>.jsonl`. When both exist, mine the
longer file — either copy can be the truncated one. Skip an id with no
readable candidate.

When the mine set ends up with no readable file, the session cannot be
resolved: escalate per Escalation. Use `<rootId>` as the session conversation
id in evidence, and cite each mined transcript by path.
