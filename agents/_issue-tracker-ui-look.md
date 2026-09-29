# UI look

Not a spawnable agent (no frontmatter). Cross-cutting look procedure for
UI-related Tasks and Stories. Callers **Read** this file from disk — a markdown link alone
is not enough.

Absolute path for this file (Read this exact path):

`/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-ui-look.md`

**Read** `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-verification-store.md`.

`<issueId>` is the issue the caller is verifying. The caller names the
targets: a path on the stack, or in-page state the browser tools can reach.

1. Call `agent_stack_start` with `issueId` set to `<issueId>`. A result that
   returns `AGENT_STACK_BASE_URL` (`state.baseUrl`) is the stack to browse.
   A start that does not return that URL fails the look.
2. Call `agent_stack_redeploy` with no arguments when the worktree has a
   commit newer than the stack's last start or redeploy. Last start is
   `state.startedAt` on the start result. Last redeploy is the latest
   `agent_stack_redeploy` return in this run; when this run has not
   redeployed, only `state.startedAt` counts. In `state.worktree`, a commit
   is newer when `git log -1 --format=%cI` is a later time than that mark.
   The tool runs the Project `redeploy` phase, then `readiness`. A
   `ran: false` result means the runtime hot-reloads; continue. A non-zero
   `redeploy` or `readiness` exit fails the look.
3. Browse each target on the stack base URL with the Playwright MCP tools
   (`browser_navigate`, `browser_snapshot`). Every agent in this
   conversation shares one browser, so it may still show an earlier
   agent's page on a stack that is gone; open the first target with
   `browser_navigate` before any other browser call. Capture each target
   with `browser_take_screenshot`, passing a bare `.png` filename. Relative
   file links in browser tool results — the screenshot, and the
   `.playwright-mcp/` snapshots and console logs — resolve against the
   browser directory: `AGENT_STACK_DATA_DIR` from the start result's `env`,
   with its final `data` segment replaced by `browser`.
4. When a capture is loading, empty, failed, or unavailable, browse and
   capture that target once more.
5. When the second capture is still loading, empty, failed, or unavailable,
   the look failed. A completed look is a non-loading, non-empty screenshot
   — liveness only. The caller judges product quality on that capture.
6. Attach each judged screenshot with `issue attach <issueId> <file>`,
   using its absolute path in the browser directory. Each attach
   prints the stored basename.
7. The caller records these three evidence fields in the report it already
   makes for this look — do not post an extra comment solely for the look:
   - **Targets** — the screens captured
   - **Recapture** — whether step 4 ran (`yes` / `no`)
   - **Look** — `pass` when step 5 left a completed look; `fail` otherwise
   Cite each attached basename in that same report.
