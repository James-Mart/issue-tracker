# issue-tracker

A local Cursor plugin: a dark shadcn/ui web app plus a CLI over a file-backed,
hierarchical work tracker (**Project > Epic > Story > Task**) that maps
directly onto git stacked PRs. A directory per issue on disk is the source of
truth; all writes funnel through one validated service layer so issues cannot be
misconfigured. It is metadata-only with respect to git — it records the git state
agents set (`branchName`, `prUrl`, `commitSha`, `merged`) and never runs git itself.

It replaces the giant "plan" doc: an agent authors a spec into a
Project > Epic > Story > Task tree, then works the tree — updating state and
conversing per issue — while a human watches live in the browser. A **Project**
is the top-level container that groups related Epics; the web UI's sidebar
selects one Project and scopes the tree and Ready view to it.

## Layout

- `app/` — Vite + React frontend (default `:8060`, override `VITE_DEV_PORT`),
  Express + WebSocket backend (default `:8061`, override `PORT`), and
  a CLI (`app/cli.ts`, exposed as a `bin`).
  - `app/server/schemas.ts` — the kind-discriminated zod schema (single source
    of truth for validation).
  - `app/server/services/issues.ts` — the service layer: the only sanctioned
    writer of `issues/`.
  - `app/server/services/derive.ts` — pure derived state (status, ready/blocked,
    base, ready set, problems).
  - `app/server/routes/` — thin HTTP adapters over the service layer.
  - `app/src/features/issues/` — the React UI (tree / ready / detail, git-stack
    panel, chat, live WebSocket updates).
- `issues/` — one directory per issue; the on-disk source of truth.
- `skills/issue-tracker/SKILL.md` — launch the issue-tracker web UI for the
  file-backed Project > Epic > Story > Task work tracker.
- `skills/issue-tracker-authoring/SKILL.md` — author a standalone issue-tracker
  plan tree as one nested YAML doc and `apply` it (git PR stacks,
  Epic/Story/Task grain, multi-root splits, turning a plan into tracked issues).
- `SPEC.md` — the canonical glossary + design rationale, referenced by both
  skills.

## Run

```bash
cd app && npm install && npm run dev
```

- Frontend (Vite): http://localhost:8060 by default (`VITE_DEV_PORT` overrides)
- Backend (Express API + WebSocket): http://localhost:8061 by default (`PORT` overrides)
- Vite proxies `/api` to `VITE_API_PROXY_TARGET` (default
  `http://localhost:8061`). With `strictPort: true`, a busy Vite port fails
  instead of walking to the next port.

Other scripts: `npm test` (Vitest) and `npm run build` (build the client into
`dist/`). `npm start` and `npm run preview` run the Express server, but it only
serves the built client when `NODE_ENV=production` **and** `dist/` exists;
otherwise it runs API-only on `:8061` (use `npm run dev` for the full UI, or
`npm run build && NODE_ENV=production npm start` to serve the built client). Run
the CLI with `npx tsx cli.ts <command>` (see `issue --help` or SPEC.md).

### Agent verification stack

Agents verify server/UI changes on their own stack rather than restarting the
one you are using. In agents-chat, call the custom tools `agent_stack_start`
and `agent_stack_stop` (session-scoped; no conversation-id argument). From a
shell:

```bash
cd app && npm run agent-stack -- start <conversationId>
cd app && npm run agent-stack -- stop <conversationId>
```

`start` picks two free ports, brings up the API and Vite in watch mode against
them, records the ports and pids at
`conversations/<conversationId>/agent-stack/state.json`, indexes the Cursor
session under `conversations/agent-stack-cursor-index/` for the kill-guard, and
prints the env contract callers use — `AGENT_STACK_API_PORT`,
`AGENT_STACK_VITE_PORT`, and `AGENT_STACK_BASE_URL`. Starting again while that
conversation's stack is live returns the running one. `stop` frees the ports
and clears state plus the cursor index; child output stays in `api.log` /
`vite.log` next to the state file.

### Cursor commit attribution hook

Run once per machine from `app/`:

```bash
cd app && npm run install-hooks
```

This writes (or updates) `~/.cursor/hooks.json` with `hooks.preToolUse` entries
for `app/hooks/strip-cursor-attribution.mjs` and `app/hooks/port-kill-guard.mjs`
before every Shell tool call. The attribution hook strips Cursor's
`Co-authored-by: Cursor <cursoragent@cursor.com>` trailer from `git commit`
commands and the trailing `Made with [Cursor](https://cursor.com)` footer from
agent `gh pr create` `--body` / HEREDOC bodies so agent-driven commits and PRs
stay clean. The kill-guard refuses kill-shaped commands aimed at ports this
conversation does not currently own and redirects the agent to
`agent_stack_start`. The server refuses to start until both hooks are registered
for the current checkout. Re-run after moving the checkout; the command is
idempotent and preserves unrelated hooks.

## How the pieces fit

The **service layer** (`services/issues.ts`) is the only writer of `issues/`. It
validates every write against the whole issue set (refusing dangling/wrong-kind/
cyclic references), applies partial-merge updates, serializes writes, and never
stores derived state.

Three thin adapters sit over it:

- **CLI** (`app/cli.ts`) — the interface agents use to author and work the stack.
- **HTTP API** (`routes/issues.ts`) — `GET /api/issues` (issues + derived +
  ready + problems), `GET /api/issues/:id`, `GET /api/issues/:id/comments`,
  `POST /api/issues`, `PATCH /api/issues/:id`, `DELETE /api/issues/:id`,
  `POST /api/issues/:id/comments` — what the UI calls.
- **WebSocket** (`/api/ws`) — one multiplexed connection per tab; the `issues`
  topic carries chokidar watcher frames so the UI updates live, and
  `conversation:<id>` carries conversation deltas.

The **UI** reads through TanStack Query and mutates through the HTTP API; the
WebSocket patches the cache so on-disk changes (from the CLI or by hand) appear
without a refresh.

## Learn more

- [SPEC.md](./SPEC.md) — glossary (Kinds, relationships, the diamond, derived
  state) and design rationale. Read this before changing tracker code.
- [skills/issue-tracker/SKILL.md](./skills/issue-tracker/SKILL.md) — launch the
  issue-tracker web UI for the file-backed Project > Epic > Story > Task work
  tracker.
- [skills/issue-tracker-authoring/SKILL.md](./skills/issue-tracker-authoring/SKILL.md)
  — author a standalone issue-tracker plan tree as one nested YAML doc and
  `apply` it (git PR stacks, Epic/Story/Task grain, multi-root splits, turning a
  plan into tracked issues).
