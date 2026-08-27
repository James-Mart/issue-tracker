# UI look

Not a spawnable agent (no frontmatter). Cross-cutting look procedure for
UI-related Tasks. Callers **Read** this file from disk — a markdown link alone
is not enough.

Absolute path for this file (Read this exact path):

`/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-ui-look.md`

1. Call `agent_stack_start` or export `AGENT_STACK_BASE_URL` from an existing
   stack.
2. Run `cd app && npm run screenshots -- <path-or-dialog>` for the Task's
   visible surface. Read PNGs under `/tmp/issue-tracker-screenshots`.
3. Use Cursor browser MCP tools only for interaction needed to reach a state,
   not for screenshot capture.
4. If the look is loading, empty, failed, or unavailable, re-run the same
   screenshots command once.
5. If the second look is still loading, empty, failed, or unavailable, the look
   failed. A completed look is a non-loading, non-empty PNG — liveness only.
   The caller judges product quality on that capture; this include stops at
   liveness.
6. The caller records these three evidence fields on the Task comment they
   already post for this look — do not post an extra comment solely for the
   look:
   - **Targets** — the path(s) or dialog name(s) captured
   - **Recapture** — whether step 4 ran (`yes` / `no`)
   - **Look** — `pass` when step 5 produced a completed look; `fail` otherwise
   The code-quality validator attaches each judged PNG to the Task
   (`issue attach <taskId> <png>`) and embeds the stored basename in that same
   comment as `![name](name)`. Other callers do not attach PNGs.
