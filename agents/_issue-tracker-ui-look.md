# UI look

Not a spawnable agent (no frontmatter). Cross-cutting look procedure for
UI-related Tasks. Callers **Read** this file from disk — a markdown link alone
is not enough.

Absolute path for this file (Read this exact path):

`/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-ui-look.md`

**Read** `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-verification-store.md`.

1. Call `agent_stack_start` with `issueId` set to the issue being verified.
   Export the returned `AGENT_STACK_BASE_URL` into the shell.
2. Run `npm run screenshots -- <path-or-dialog>` or
   `npm run screenshots -- --driver <absolute path>` from the plugin `app/` beside
   `agents/_issue-tracker-ui-look.md` (workspace-relative `app/`). Pass the
   Task's path or dialog, or write a driver script under `/tmp` that exports
   `async function reach(page)` to open in-page state the harness cannot reach
   with a path or dialog alone. The summary Workspace checkout is the server,
   and this `app/` is the capture script. Read PNGs under
   `/tmp/issue-tracker-screenshots`.
3. If the look is loading, empty, failed, or unavailable, re-run the same
   screenshots command once.
4. If the second look is still loading, empty, failed, or unavailable, the look
   failed. A completed look is a non-loading, non-empty PNG — liveness only.
   The caller judges product quality on that capture; this include stops at
   liveness.
5. The caller records these three evidence fields on the Task comment they
   already post for this look — do not post an extra comment solely for the
   look:
   - **Targets** — the path(s), dialog name(s), or driver path captured
   - **Recapture** — whether step 3 ran (`yes` / `no`)
   - **Look** — `pass` when step 4 produced a completed look; `fail` otherwise
   The code-quality validator attaches each judged PNG to the Task
   (`issue attach <taskId> <png>`) and embeds the stored basename in that same
   comment as `![name](name)`. Other callers do not attach PNGs.
