# Retro — Transcript resolution

Not a spawnable agent (no frontmatter). Loaded when resolving the invoking
run's transcript tree. Used by `issue-tracker-retro`.

Absolute path for this file (Read this exact path):

`/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-retro-transcript-resolution.md`

`$CURSOR_CONVERSATION_ID` may be the parent implement-run id or a Cursor Task
subagent id. Resolve the parent tree.

A directory `D` is a **Source-run root** when `D/<basename(D)>.jsonl` exists.

1. Let `direct = $AGENT_TRANSCRIPTS/$CURSOR_CONVERSATION_ID`. If `direct` is a
   Source-run root, `<root> = direct`.
2. Otherwise set `currentId = $CURSOR_CONVERSATION_ID` and maintain a `visited`
   set of candidate directories; loop:
   - Find matches for `$AGENT_TRANSCRIPTS/*/subagents/<currentId>.jsonl`.
   - Zero matches → escalate per Escalation — absence is not a clean run.
   - More than one match → escalate per Escalation — do not pick a winner.
   - One match → `candidate` = directory containing that `subagents/`.
   - If `candidate` was already visited → escalate per Escalation (cycle).
   - If `candidate` is a Source-run root → `<root> = candidate`; stop.
   - Add `candidate` to `visited`; set `currentId = basename(candidate)` and
     continue.

Set `<parentId> = basename(<root>)`. Mine `<root>/<parentId>.jsonl` (required —
escalate per Escalation if unreadable) plus any `<root>/subagents/*.jsonl`
(optional). Use `<parentId>` as the Source-run conversation id in evidence.
