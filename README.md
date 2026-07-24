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

- `app/` — Vite + React frontend (`:8060`), Express + SSE backend (`:8061`), and
  a CLI (`app/cli.ts`, exposed as a `bin`).
  - `app/server/schemas.ts` — the kind-discriminated zod schema (single source
    of truth for validation).
  - `app/server/services/issues.ts` — the service layer: the only sanctioned
    writer of `issues/`.
  - `app/server/services/derive.ts` — pure derived state (status, ready/blocked,
    base, ready set, problems).
  - `app/server/routes/` — thin HTTP + SSE adapters over the service layer.
  - `app/src/features/issues/` — the React UI (tree / ready / detail, git-stack
    panel, chat, live SSE updates).
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

- Frontend (Vite): http://localhost:8060
- Backend (Express API + SSE): http://localhost:8061

Other scripts: `npm test` (Vitest) and `npm run build` (build the client into
`dist/`). `npm start` and `npm run preview` run the Express server, but it only
serves the built client when `NODE_ENV=production` **and** `dist/` exists;
otherwise it runs API-only on `:8061` (use `npm run dev` for the full UI, or
`npm run build && NODE_ENV=production npm start` to serve the built client). Run
the CLI with `npx tsx cli.ts <command>` (see `issue --help` or SPEC.md).

## How the pieces fit

The **service layer** (`services/issues.ts`) is the only writer of `issues/`. It
validates every write against the whole issue set (refusing dangling/wrong-kind/
cyclic references), applies partial-merge updates, serializes writes, and never
stores derived state.

Three thin adapters sit over it:

- **CLI** (`app/cli.ts`) — the interface agents use to author and work the stack.
- **HTTP API** (`routes/issues.ts`) — `GET /api/issues` (issues + derived +
  ready + problems), `GET /api/issues/:id`, `GET /api/issues/:id/chat`,
  `POST /api/issues`, `PATCH /api/issues/:id`, `DELETE /api/issues/:id`,
  `POST /api/issues/:id/messages` — what the UI calls.
- **SSE** (`routes/events.ts`) — `GET /api/events`; a chokidar watcher on
  `issues/**` pushes change events so the UI updates live.

The **UI** reads through TanStack Query and mutates through the HTTP API; SSE
patches the cache so on-disk changes (from the CLI or by hand) appear without a
refresh.

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
