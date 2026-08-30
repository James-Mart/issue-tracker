---
name: issue-tracker
disable-model-invocation: true
description: >-
  Launch the issue-tracker web UI for the file-backed Project > Epic >
  Story > Task work tracker. Use when the user asks to open the issue
  tracker, launch the tracker UI, see the tree, or watch agents work a
  stack of PRs live.
---

# Issue Tracker

A local work tracker (dark shadcn/ui web app) that replaces the giant "plan"
doc: an agent authors a spec into a **Project > Epic > Story > Task** tree
that maps directly onto git stacked PRs, then works the tree while a human
watches live in the browser. A **Project** is the top-level container (an
organizational grouping of Epics); a directory per issue on disk is the
source of truth; the CLI (for agents) and HTTP/SSE (for the UI) are thin
adapters over one validated service layer. Markdown specs, per-issue comments,
and derived blocked/status state live in that UI.

Read [SPEC.md](../../SPEC.md) for the full glossary (Kinds, relationships,
derived state) and design rationale.

## Start the dev server

```bash
cd app && npm install && npm run dev
```

This starts:

- Vite dev server on http://localhost:8060 by default (frontend; override
  `VITE_DEV_PORT`)
- Express API + SSE server on http://localhost:8061 by default (backend;
  override `PORT`)
- Vite proxies `/api` to `VITE_API_PROXY_TARGET` (default
  `http://localhost:8061`). With `strictPort: true`, a busy Vite port fails
  instead of walking to the next port.

Tell the user the UI is available at the Vite URL (default
http://localhost:8060).

## Agent verification stack

When verifying server or UI changes from an in-app agents-chat session, call
the custom tools `agent_stack_start` and `agent_stack_stop` (no conversation-id
argument — they are scoped to the current conversation). `agent_stack_start`
brings up an API+Vite watch pair on free ports and returns the env contract
`AGENT_STACK_API_PORT`, `AGENT_STACK_VITE_PORT`, and `AGENT_STACK_BASE_URL`.
Export those into the shell before screenshots, Playwright e2e, or other probes.
Do not stop or restart the human's stack on 8060/8061 to test a lifecycle path.
Call `agent_stack_stop` when finished.

Outside agents-chat, the same lifecycle is available as:

```bash
cd app && npm run agent-stack -- start <conversationId>
cd app && npm run agent-stack -- stop <conversationId>
```

## UI screenshots

For agents validating or attaching UI state, use the Playwright capture script
(not Cursor IDE browser screenshot tools). Call `agent_stack_start` when
needed and export `AGENT_STACK_BASE_URL` into the shell; the script uses that
env as its default base URL (still overridable with `--base-url`).

```bash
cd app && npm run screenshots -- [options] <path-or-dialog>...
```

- **Pages** — path targets starting with `/` (e.g. `/`,
  `/projects/issue-tracker?lens=structure`).
- **Dialogs** — named ids (e.g. `new-project`, `delete-issue`); run
  `npm run screenshots -- --list` to print names.
- **Output** — defaults to `/tmp/issue-tracker-screenshots`; copy PNGs out of
  `/tmp` when attaching to issues.
- **Discovery** — `npm run screenshots -- --help` for flags; `--all` captures
  common paths plus all dialogs for a project. Full contract: Story
  `agent-ui-screenshot-capture`.

## Playwright e2e

`npm run test:e2e` runs Playwright specs under `app/e2e/`. Call
`agent_stack_start` when needed and export `AGENT_STACK_BASE_URL` into the
shell first; smoke specs use that env as `baseURL` and Playwright will not
start `npm run dev` on the human default ports. Seeded specs boot their own
ephemeral Express server and ignore the config `baseURL`. With env unset,
smoke keeps today's behavior (`http://localhost:8060` plus `webServer`).

```bash
cd app && npm run test:e2e
```

## What it shows

- **Project sidebar** — a collapsible sidebar lists Projects; selecting one
  scopes the tree to that Project. Create/rename/delete Projects from the
  sidebar (deleting a Project cascades to all its Epics/Stories/Tasks).
- **Tree view** — collapsible Epic > Story > Task outline (scoped to the
  selected Project) with derived status badges, git/stack chips (branch,
  mergeBase, PR, merged, sha), Task `assignee` and Epic/Story/Task
  `needsAttention` badges, and blocked rows
  dimmed. Archived Epic / Story / Task rows are hidden by default; a "Show
  archived" toggle (client preference, next to search) reveals them. Row hover
  offers Archive / Unarchive (same cascade as CLI).
- **Detail** — the issue's `description.md` rendered as GFM (with `issue:`
  cross-links and relative links to that issue's `attachments/`), an edit form
  (Task `assignee`, Epic/Story/Task `needsAttention`, Task `status`, git facts),
  Archive / Unarchive in the header (Epic / Story / Task), attachment
  list/upload/download, a git/stack panel, Task `assignee` and Epic/Story/Task
  `needsAttention` badges (`attentionReason` when
  set), and (for Stories with `review` set) a review chip (`passed` /
  `failed`, plus a stale marker when coverage is out of date; omitted when
  unset), (for Tasks with `noDiff` set) a no-diff chip
  (omitted when unset), and a per-issue comment log.
- Changes to `issues/` on disk (from the CLI or by hand) appear live over SSE
  without a refresh.

## When to use it

Open this UI when a human wants to watch or steer an agent working a stack of
PRs. Agents themselves do **not** use this UI — they drive the CLI.

## Agent skills (pick by task)

- **`issue-tracker-authoring`** — author a standalone issue-tracker plan tree as
  one nested YAML doc and `apply` it; use when planning git PR stacks,
  Epic/Story/Task grain, multi-root splits, or turning a plan into tracked
  issues.
- **`issue-tracker-work`** — coordinate implementation of an Epic or
  project-level Story by spawning plugin subagents — do not implement yourself;
  use when implementing or working a tracker Epic/Story.
- **`issue-tracker-plan`** — grill an Idea into a plan tree via apply, then
  auto-chain polish and retro; use when planning an Idea, fleshing out a tracker
  plan, or running issue-tracker-plan.
- **`issue-tracker-auto-plan`** — autonomously plan a single Idea as a
  hands-off stakeholder on opus 5; use when the user runs auto-plan or auto
  plan or wants hands-off planning of an Idea id.
- **`issue-tracker-plan-polish`** — polish an existing Epic or project-level
  Story plan tree with parallel check agents, then auto-apply when safe; use
  when polishing a plan, cleaning up a tracker tree, or running plan-polish.
- **`issue-tracker-mockup`** — run one mockup round for one UI surface via
  the design-conformance agent (one conformant direction by default, capture,
  attach); use when the user asks for a mockup round, UI mockups, or a design
  direction for an issue.
- **`issue-tracker-vision-docs`** — author or revise a Project vision doc (main
  vision or one subsystem vision) through a single grill and an approved
  draft; use when writing or refining project vision, authoring a subsystem
  vision doc, or running vision refinement.
- **`issue-tracker-project-docs`** — author or revise coding standards or
  design system and record in `supportingDocs`; use when writing or updating
  project coding standards or design system.
