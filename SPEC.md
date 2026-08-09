# issue-tracker: glossary + design rationale

This is the canonical glossary for the issue-tracker plugin, referenced by both
skills. It defines every term the code, docs, and UI use, and explains the
design decisions that make the model correct-by-construction. Read it before
authoring issues or changing tracker code.

The tracker models work as a tree of **Project > Epic > Story > Task** nodes
that maps onto git stacked PRs, plus **Idea** nodes and optional **project-level
Stories** that sit beside Epics under a Project (Ideas are capture items, not
work; a project-level Story is work without an Epic wrapper). A directory per
issue on disk is the sole source of truth; a validated service layer
(`issues.ts` + sibling writers such as `attachments.ts`) is the only sanctioned
writer; all state that could drift is derived, never stored.

## Glossary

### Kinds

#### Kinds vs git vocabulary

Kind names are **Story** and **Task**. A Story is planned as one git branch +
PR; a Task as one git commit. Git fact field names (`branchName`, `commitSha`,
`mergeBase`, …) and git-subagent modes (`start-branch`, `finish-commit`,
`finish-branch`) stay **git-shaped** — they are not renamed to match kinds.

Every issue has a `kind`, one of:

- **Project** — the top-level container that groups related Epics, Ideas, and
  project-level Stories. Purely organizational: it carries **no status**
  (derived or stored) and none of the assignee/needs-attention fields — a
  `title`, a `description.md` overview, an optional `workspace` (the absolute
  path to the local git checkout this Project covers; repo-touching agents run
  there — see [workspace](#project-workspace)), a `trunk` git ref (default for
  derived `mergeBase` when no `mergeBaseOverride` applies; defaults `main` —
  see [Project trunk](#project-trunk)), and an optional closed `labels` catalog
  (see [Project labels](#project-labels)). Has no `partOf`.
- **Epic** — a body of work (replaces a giant plan/spec). Contains Stories; its
  `description.md` holds the spec. Carries `blockedBy` (a list of other Epic ids
  in the same Project that must finish first), an optional `mergeBaseOverride`
  (redirects first-layer Stories' derived `mergeBase` away from `trunk` — see
  [stacked-PR merge model](#the-stacked-pr-merge-model)), an optional
  informational `retro` record (`in-progress` while mining, `done` once retro
  posts its terminal comment; no workflow branches on it), and optional
  `labels` assignments from the
  Project catalog (see [Project labels](#project-labels)). Has **no stored
  status** — its status is fully derived from descendants. Is `partOf` a
  Project (required). Prefer an Epic when the plan needs sibling root Stories,
  stacking, or Epic `blockedBy`.
- **Idea** — a Project-level capture item (title, description, attachments,
  archive, and optional `labels` assignments from the Project catalog — see
  [Project labels](#project-labels)) that agents and humans mine later into
  real work. Leaf kind: no children, no assignee/needs-attention, no status or
  git fields. Supports chat and kind-scoped CLI `comment` (same path as other
  kinds). Is `partOf` a Project (required). Epics, Ideas, and
  *root* project-level Stories share one Project-child sibling `order` space.
  There is no separate Idea Board kind — the "board" is the Project's board
  children in the tree/CLI/UI.
- **Story** — a unit of work that contains Tasks. Is `partOf` an **Epic** or a
  **Project** (required). A Story under a Project (no Epic) is a
  *project-level Story* — use it when the plan is a single Story plus its
  Tasks. Prefer wrapping in an Epic when you need sibling root Stories,
  stacking, or Epic `blockedBy`. Carries `branchName`, `stackedOn`,
  `prUrl`, `merged`, `specReview`, an optional informational `retro` record
  (`in-progress` while mining, `done` once retro posts its terminal comment;
  same enum as Epic; no workflow branches on it), and optional `labels`
  assignments from
  the containing Project catalog (see [Project labels](#project-labels)).
  Status and derived `mergeBase` are never stored. A project-level root Story
  may also store `mergeBaseOverride` (set via imperative `mergeBase` — see
  [stacked-PR merge model](#the-stacked-pr-merge-model)).
- **Task** — an atomic, story-point-sized unit under a Story. Each Task is a
  **small but standalone cross-section** of the work: after it lands on the
  Story tip, the package must still **build** and tests must remain
  **meaningful** (vertical slices, not horizontal layers such as types-only,
  wire-up-later, or half-migrations that do not compile). The only kind with a
  **stored** `status` (`todo` / `in-progress` / `fixing` / `done`), an optional
  `assignee` (Task-only ownership; in the work loop, overloaded as the
  implementor model family key — `composer`, `grok`, or `opus`), an optional
  `qa` gate (`reviewing` /
  `changes-requested` / `passed`), an optional `commitSha` (set when done with a
  real git commit), and an optional `noDiff` flag (set via kind
  [`set`](#kind-scoped-get--set) when the implementor deliberately lands no
  source-controlled file changes).

### Relationships

Three relationships, each with a distinct, non-overlapping role:

- **partOf** — *containment*: the node this one belongs to. A Task is `partOf`
  a Story; a Story is `partOf` an Epic **or** a Project; an Epic or Idea is
  `partOf` a Project. It points exactly one tier up and builds the tree.
  Projects have none.
- **stackedOn** — *the single git fork point* of a Story: which one Story it
  forks from. Story-only, always singular, and strictly within one container
  (same Epic, or same Project for project-level Stories). Absent means
  unstacked — derived `mergeBase` follows
  [stacked-PR merge model](#the-stacked-pr-merge-model) (override or Project
  **trunk**). It is the **sole** inter-Story edge, so within a container the
  Stories form a forest of independent stacks — a tree, never a DAG, with no
  internal merge gate. Authoring preference: stacks belong under an Epic; a
  lone project-level Story is the usual Project-child form.
- **blockedBy** — *cross-Epic ordering*: a list of other Epic ids **in the same
  Project** that must finish (all their Stories merged) before this Epic can
  start. Epic-only, and the only edge that crosses an Epic boundary. This is what
  makes the Epic-level dependency graph a DAG.

#### The diamond (why a multi-parent dependency becomes a new Epic)

The one thing a single `stackedOn` fork point cannot express is a unit that needs
code from **two** parallel Stories at once (the classic diamond: Stories A and
B both fork the Project trunk, worked in parallel, and C needs both). Rather than
reintroduce a Story-level multi-parent edge — which would force a merge gate
*inside* an Epic and break the "one Epic run = one clean, bottom-up-mergeable
stack of PRs" property — we resolve it at the Epic boundary: split the dependent
unit into a **new Epic that is `blockedBy` the Epic holding the parallel
Stories** (A and B). The tradeoff is
deliberate: keeping A and B in one Epic preserves their parallelism (two
independent stacks, no gate between them), while moving C into a second Epic makes
it wait for the whole blocking Epic to *merge* first — coarser, but landing
exactly where a merge round-trip is natural (a human-paced Epic boundary) instead
of stalling a stack mid-flight.

#### The stacked-PR merge model

Every Story has a derived **`mergeBase`**: the git ref that `start-branch`
checks out from and that `finish-branch` targets for PR/merge. It is
resolved on read — never stored on disk, never written by cascades. Call
sites use `issue story get <storyId> mergeBase`.

An optional stored **`mergeBaseOverride`** on a **project-level root Story**
(`partOf` the Project, no `stackedOn`) or an **Epic** redirects unstacked
resolution away from `project.trunk`. The CLI setter is named `mergeBase`
and writes that stored key (same alias pattern as other imperative sets):

```
issue story set <rootStoryId> mergeBase <branch>
issue epic set <epicId> mergeBase <branch>
```

`issue story get <storyId> mergeBase` stays the **derived** value (override
already layered in). Setting `mergeBase` on a stacked Story or a first-layer
Epic Story is refused (`mergeBase can only be set on a root-level Story or an
Epic`). First-layer Epic Stories inherit the Epic's base and cannot carry
their own override (keeps one base per Epic). `apply` never reads or writes
`mergeBaseOverride`.

- **Resolver** — canonical algorithm (same as `derive()` /
  `issue story get … mergeBase` / `app/server/resolve-merge-base.ts`):
  - no `stackedOn`, `partOf` a Project (root Story) → that Story's
    `mergeBaseOverride` if set, else the Project's `trunk` (defaults `main`)
  - no `stackedOn`, `partOf` an Epic (first-layer Story) → the Epic's
    `mergeBaseOverride` if set, else the Project's `trunk` (any override on
    the Story itself is ignored)
  - stacked on a merged parent → `resolve(parent)` (walk the parent's stack)
  - else parent's `branchName` when set; else unset
- **No cascades.** Changing a parent's `branchName`, `merged`, or
  `mergeBaseOverride` does not write child `mergeBase` keys; the next read
  sees the new topology. After a parent lands (`merged` → `true`), children
  typically resolve to the parent's resolved base (override or Project trunk,
  or further up the stack). Open GitHub PRs are retargeted by GitHub itself;
  the tracker does not run PR-base CLI — see
  [Project merge policy](#project-merge-policy).
- **Rename guard**: once a Story has a `branchName` and any child is stacked
  on it, a real `branchName` rename is refused (same-value no-op still
  allowed), even though tracker metadata would otherwise re-derive. That keeps
  git branch identity stable for stacked children.

A stack still lands bottom-up: finish the parent first, then each child.
Consequently **each Story must be independently mergeable** into its
`mergeBase` — merging it must leave that base building and self-consistent.
Only Stories merge; Tasks are internal steps that ship together as their
Story's single PR, so an individual Task need not be *shippable* alone but
the Story as a whole must be. A Task *must* still leave the Story tip
**buildable and testable** — see [Task](#kinds). Never split one cohesive
change across separate Stories such that merging one would leave the base
broken (for example a schema change in one Story and the code that consumes
it in another): keep it in one Story as multiple Tasks.

Under `pull-request` / `manual` [merge policies](#project-merge-policy), each
finished Story is planned as a PR against its derived `mergeBase` (after
parent merge, usually the Project trunk or an explicit override). The local
`merge` and `fast-forward` policies integrate each finished Story directly into
that same derived `mergeBase` with no PR, so a stack still lands bottom-up but
never touches a remote PR.

### Derived terms

These are computed by `derive()` and never written to disk (see
[Derived state](#derived-state)):

- **Stack** — the emergent set of dependent, not-yet-merged Stories under one
  container (an Epic, or a Project for project-level Stories), induced solely by
  `stackedOn`: a forest of independent stacks (each a tree), never a
  cross-Story DAG.
- **blocked** — whether an issue is waiting on a dependency (per-kind rules in
  [Derived state](#derived-state)).
- **Story status** — `not-started` / `in-progress` / `pr-open` / `merged`.
- **Epic status** — `todo` / `in-progress` / `done` (rollup of its Stories).
- **mergeBase** — tree chip `mergeBase=<ref>` / `mergeBase=(unset)`;
  also `issue story get … mergeBase`. Resolution:
  [stacked-PR merge model](#the-stacked-pr-merge-model). No second name
  (`base`).
- **needs-attention** — an escalation flag (`needsAttention` + `attentionReason`),
  orthogonal to status; Epic / Story / Task can carry it (Project and Idea
  cannot).
- **assignee** — Task-only. Who currently owns the Task (e.g. `human` or an
  agent id); in the work loop, overloaded as the implementor model family key
  (`composer`, `grok`, or `opus`).
- **specReview** — a Story-only machine-readable spec-review gate (`passed` /
  `failed`; absent until set via kind [`set`](#kind-scoped-get--set)). Surfaced
  in the detail panel when set; omitted from the tree outline.
- **noDiff** — a Task-only signal that the implementor intentionally landed no
  source-controlled file changes (`true`; absent until set via kind
  [`set`](#kind-scoped-get--set)). Edits that only touch non-source-controlled
  files (e.g. under the gitignored `issues/` store) still warrant `noDiff`; do
  not read the flag as "nothing was done." Surfaced in the detail panel when
  set; omitted from the tree outline. An empty working tree alone is **not** a
  completion signal — see [Finish commit](#finish-commit).
- **archived** — stored visibility flag on Epic / Idea / Story / Task (never
  Project). Explicit; **not** auto-derived from Done. Cascade and CLI/UI
  filtering — see [Archived visibility](#archived-visibility).
- **problems** — integrity issues that are surfaced, never silently ignored:
  dependency cycles, dangling `partOf`/`stackedOn`/`blockedBy` ids, kind
  violations, and malformed/invalid files.

<a id="cli-invariants"></a>

## CLI invariants

Durable, cross-cutting rules for driving the tracker CLI. Per-command verbs and
flags live in `issue --help` and [CLI surface](#cli-surface); this section is
the shared contract skills and agents point at for invariants that are not
per-command.

- **Act only through the CLI.** Never hand-edit `issue.json` (or other tracker
  files) to change state. The CLI wraps the validated service layer and
  re-validates the whole set on each write.
- **Nonzero exit = refused.** On bad inputs or integrity violations the CLI
  exits nonzero with a message and leaves disk unchanged. Read the message, fix
  the inputs, and retry — do not retry the same invocation blindly. If `list`
  reports `problems`, resolve them first.
- **Issues directory.** Default is the plugin's own `issues/` directory.
  `ISSUES_DIR=/abs/path` overrides it (match the UI/server so the human sees
  changes live). Agents should leave `ISSUES_DIR` unset unless they intend that
  override.
- **`issue` bin.** Prefer `issue <verb> …`. One-time setup: `npm link` in this
  plugin's `app/` directory (`/root/.cursor/plugins/local/issue-tracker/app`).
- **Print after durable write.** Mutating CLI commands must finish all durable
  writes before writing to stdout or stderr. That ordering is what makes a hard
  exit on EPIPE safe when the consumer closes the pipe early.

## CLI surface

Six kind-uniform single-issue ops take a bare id and dispatch on the issue's
stored `kind`: `view`, `get`, `comment`, `attach`, `attachments`, `detach`.
`set`, `add`, and `delete` stay kind-scoped — their flag surface genuinely
differs by kind. Multi-kind / board ops stay global.

The kind-scoped spellings `issue <kind> view|get|comment|attach|attachments|detach`
remain available as asserting aliases: the CLI kind must equal the issue's
stored `kind` (hard error otherwise).

### Bare-id ops (kind-uniform)

```
issue view|get|comment|attach|attachments|detach <id> …
```

| verb | notes |
| --- | --- |
| `view` / `get` / `attach` / `attachments` / `detach` | every kind |
| `comment` | epic / idea / story / task (not project) |

- **`view`** — `issue view <id>` (pass `--chat` for the chat log).
  Prefer `issue get <id> <field>` for a single field. Label lines: see
  [Project labels](#project-labels).
- **`get`** — `issue get <id> <field>`; field rules match kind-scoped
  [get / set](#kind-scoped-get--set).
- **`comment`** — `issue comment <id> --role <role> --body <text>`
  (optional `--name`); refuses a Project id; see [Service layer](#service-layer).
- **`attach` / `attachments` / `detach`** —
  `issue attach <id> <file>` /
  `issue attachments <id>` /
  `issue detach <id> <name>`; see [Attachments](#attachments).

### Kind-scoped ops

```
issue <kind> add|get|set|view|delete|comment|attach|attachments|detach
```

`<kind>` is one of `project` | `epic` | `idea` | `story` | `task`.

| verb | kinds |
| --- | --- |
| `add` / `set` / `delete` | every kind |
| `get` / `view` / `attach` / `attachments` / `detach` | every kind (asserting aliases) |
| `comment` | epic / idea / story / task (not project; asserting alias) |

- **`add`** — `issue project add <title>` (no `--part-of`); children take
  `--part-of`. Description: `--description` and/or `--file` (use `-` for
  stdin). Also: `--assignee` on task; `--stacked-on` on story.
  Prints the new id on stdout.
- **`view`** — asserting alias for `issue view <id>`.
- **`delete`** — `issue <kind> delete <id>`; cascades per
  [Deletion policy](#deletion-policy).
- **`comment`** — asserting alias for `issue comment <id> …`.
- **`attach` / `attachments` / `detach`** — asserting aliases; see
  [Attachments](#attachments).

### Global ops

```
issue apply|tree|summary|list
```

- **`apply`** — declarative upsert; see [`apply` doc format](#apply-doc-format).
- **`summary <id>`** — Project → … → target chain for agent bootstrap
  (including Project → Story → Task for a project-level Story).
  (`summary`'s `Workspace:` line remains the bootstrap contract for
  [Project workspace](#project-workspace) resolution.)
- **`tree [id]`** — optional positional `[id]` scopes the subtree (no title
  lookup). Omitted = all projects; project / epic / story scopes the subtree;
  idea / task refused. Under a Project, `tree` interleaves Epics, Ideas, and
  *root* project-level Stories by shared sibling `order` (stacked
  project-level Stories nest under their fork point).
- **`list [kind] [--in <containerId>]`** — optional kind positional filters
  output to one issue kind (`project` | `epic` | `idea` | `story` | `task`);
  `--in` scopes to a project / epic / story subtree (idea / task refused;
  omitted = all projects). Both are optional and combinable. JSON shape
  `issues` / `derived` / `problems`, filtered to the same visible id set.
  `--show-archived` unchanged. Label chips / no CLI label filter: see
  [Project labels](#project-labels).

<a id="kind-scoped-get--set"></a>

### Kind-scoped `get` / `set`

Field read/write:

- `issue <kind> get <id> <field>`
- `issue <kind> set <id> <field> [value] [--clear] [--add <ids...>] [--remove <ids...>] [--rename <oldId> <newId>] [--file <path|->] [--reason <text>]`

Field names are camelCase, identical to schema / `issue.json` keys. There is no
cross-kind `get`/`set`; shared fields are repeated on each kind that owns them.

Prefer `issue <kind> get <id> <field>` for scalar reads — do not parse
`view` / `summary` / `tree` for a single field.

#### `get`

- Prints the value alone on stdout (composable in `$(...)`).
- Scalars raw; arrays/objects as JSON.
- Unset optional → empty stdout, exit 0. Fields with a schema default print that
  default: an Epic with no blockers prints `[]` (arrays as JSON), not empty
  stdout.
- Readable surface is **wider than set**: any stored field for that kind plus
  derived fields (`epicStatus`, `storyStatus`, `blocked`, `mergeBase`, …).
- Includes `description` and `attentionReason` as readable fields.

#### `set`

- Typed coercion + validation; same `update` + `checkIntegrity` write path as
  `apply` / `add`.
- Per-kind **set** allowlists (not a flat shared allowlist). Shared machinery is
  only coerce/dispatch (bool/enum/JSON/array/`--clear`/`--file`/`--reason`).
- `order` is not settable. Story `mergeBase` on **get** is derived; on **set**
  it writes `mergeBaseOverride` on eligible nodes only (see
  [stacked-PR merge model](#the-stacked-pr-merge-model)).
- `attentionReason` is not directly settable (see
  [`needsAttention`](#needsattention)).
- **CLI/UI parity:** `set` can do anything the UI edit form can, including
  *clearing* fields via `--clear` (behaviors below).

##### Set allowlists

| kind | settable fields |
| --- | --- |
| project | `title`, `workspace`, `trunk`, `mergePolicy`, `labels`, `supportingDocs`, `description` |
| epic | `title`, `needsAttention`, `archived`, `partOf`, `blockedBy`, `mergeBase`, `mergePolicy`, `retro`, `labels`, `description` |
| idea | `title`, `archived`, `partOf`, `labels`, `description` |
| story | `title`, `needsAttention`, `archived`, `partOf`, `branchName`, `stackedOn`, `mergeBase`, `mergePolicy`, `prUrl`, `merged`, `needsRebase`, `specReview`, `retro`, `labels`, `description` |
| task | `title`, `assignee`, `needsAttention`, `archived`, `partOf`, `status`, `qa`, `commitSha`, `noDiff`, `description` |

##### Value parsing

- Enums: literal strings.
- Booleans: only `true` / `false`.
- Arrays (`blockedBy`, assignment `labels` on epic / idea / story): full replace
  takes a positional JSON array; incremental edits use `--add <ids...>` /
  `--remove <ids...>` (variadic ids). Exactly one mode per call — positional
  value, `--add`, `--remove`, and `--clear` are mutually exclusive.
- **Project `labels` (catalog):** `--add` upserts one JSON object by `id`
  (object via `--add '{…}'`, `--file <path|->`, or positional JSON);
  `--remove <ids...>`; `--rename <oldId> <newId>`; `--clear` → `[]`. Modes are
  mutually exclusive. See [Project labels](#project-labels).
- **Project `supportingDocs`:** no positional value. Set one key with
  `--doc vision|codingStandards|designSystem` plus exactly one of
  `--attachment <name>` or `--workspace <path>`. `--clear` blanks the whole
  field; `--clear --doc <key>` removes one key. See
  [Project supporting docs](#project-supporting-docs).
- `--clear` (mutually exclusive with a positional value / `--add` / `--remove` /
  `--rename`):
  - **Clearable scalars** (`assignee`, `commitSha`, `branchName`, `stackedOn`,
    `prUrl`, `workspace`, `qa`, `retro`): blanks the field (absent / `null`).
  - **`blockedBy`** / assignment **`labels`**: sets `[]` (empty array, not null).
  - **Project `labels`**: sets `[]` (empty catalog).
  - **Project `supportingDocs`**: blanks the field (absent / `null`); with
    `--doc <key>`, removes only that key.
  - **`needsAttention`**: sets `false` and clears `attentionReason` (same as
    `needsAttention false`).
- `description`: omit positional value when `--file <path|->` is passed.
  `--file` is the generic "value from a file" flag. Kind-scoped `add` uses the
  same `--file` for seeding `description.md`.

##### `needsAttention`

- `issue <kind> set <id> needsAttention true --reason <text>` — `--reason` is
  required.
- `issue <kind> set <id> needsAttention false` — also clears `attentionReason`.
- `issue <kind> set <id> needsAttention --clear` — equivalent to `false`.

## On-disk layout

The `issues/` directory holds one directory per issue; it is the source of
truth (no database).

```
issues/<id>/
  issue.json        # metadata + relationships (machine-readable)
  description.md    # the spec/description (for an Epic, the plan). GFM; may contain issue: links
  chat.jsonl        # append-only per-issue chat, one message object per line
  attachments/      # optional; opaque files for any kind with attachments
```

- `description.md` and `chat.jsonl` are discovered **by convention** from `<id>`
  (there are no path fields, so there can be no dangling file refs). Both are
  optional; absent means empty.
- `attachments/` is likewise by convention: no manifest; scan the directory.
  Allowed on every kind with the attachments capability. See
  [Attachments](#attachments).
- `<id>` = directory name, mirrored in `issue.json.id`, **stable** across title
  edits, and globally unique across all kinds. Its *origin* depends on the
  writer, but the result is the same kind of id either way:
  - kind-scoped `add` **derives** it as a slug from the title at creation,
    adding a numeric suffix on collision (`add-auth`, `add-auth-2`);
  - the declarative [`apply`](#apply-doc-format) doc requires an
    **author-chosen** id on every node (kebab, unique, slug-safe, and
    title-independent, so it survives retitles and lets `issue:<id>` cross-links
    be authored before anything exists).

  An id is never *only* a title-slug: once written it is a stable handle
  decoupled from the title, whatever produced it.

## `issue.json` schema

A single kind-discriminated zod schema (`app/server/schemas.ts`) is the one
source of truth for validation, on both read and write. Which fields are present
depends on `kind`.

Common to every kind:

| field | type | notes |
| --- | --- | --- |
| `id` | string | = directory name; stable |
| `kind` | `"project"` \| `"epic"` \| `"idea"` \| `"story"` \| `"task"` | discriminator |
| `title` | string | non-empty |
| `order` | int | sibling position within its parent group; defaults `0` |
| `createdAt` | ISO string | set at create |
| `updatedAt` | ISO string | bumped on every write |

Common to **Epic / Story / Task** (but **not** Project or Idea):

| field | type | notes |
| --- | --- | --- |
| `needsAttention` | boolean | defaults `false` |
| `attentionReason` | string \| null | defaults `null` |

Project — the common-to-every-kind fields plus:

| field | type | notes |
| --- | --- | --- |
| `workspace` | string? | absolute path to the local git checkout this Project covers; the cwd repo-touching agents run in (see [Project workspace](#project-workspace)) |
| `trunk` | string | default git ref for derived `mergeBase` when no `mergeBaseOverride` applies; defaults `main` (see [Project trunk](#project-trunk)) |
| `mergePolicy` | `"merge"` \| `"pull-request"` \| `"manual"` \| `"fast-forward"` | Project default for derived policy; defaults `manual` (see [Project merge policy](#project-merge-policy)) |
| `labels` | `{ id, color, description? }[]`? | closed catalog of attachable labels; chip text is the kebab `id` (see [Project labels](#project-labels)) |
| `supportingDocs` | `{ vision?, codingStandards?, designSystem? }`? | optional pointers to vision / coding standards / design system docs (see [Project supporting docs](#project-supporting-docs)) |

No `partOf`, no status, no assignee/needs-attention. Its `description.md` is a
short overview of the Project.

### Project supporting docs

A Project may point at up to three optional supporting documents — **vision**,
**coding standards**, and **design system** — via the imperative
`supportingDocs` field. Each present key is a `SupportingDocRef`:

- `{ type: "attachment", name: string }` — basename already attached on the
  Project
- `{ type: "workspace", path: string }` — path relative to the Project
  `workspace` (no absolute paths, no `..`); the file must exist on disk at set
  time

Missing or unset keys mean that doc is absent. Agents resolve docs **only**
through `supportingDocs` (**consult-if-present**): no key or an unreadable
target → skip; never fail the workflow for a missing doc. Authoring guidance:
[issue-tracker-project-docs](skills/issue-tracker-project-docs/SKILL.md).

**Well-known attachment basenames** (skill default when choosing attachment
storage): `vision.md`, `coding-standards.md`, `design-system.md`.

**CLI.**

```
issue project set <id> supportingDocs --doc vision|codingStandards|designSystem \
  --attachment <name>|--workspace <path>
issue project set <id> supportingDocs --clear
issue project set <id> supportingDocs --clear --doc <key>
issue project get <id> supportingDocs
```

`get` prints JSON. `project view` and `summary` surface a `supportingDocs:`
line when the field is set. Must-exist checks run at set time only (attachment
already present; workspace file on disk under the Project workspace).

**`apply`.** Imperative-only — same class as `workspace` / `mergePolicy` /
`labels`. `apply` preserves `supportingDocs` and never reads or writes it from
the YAML doc.

**Doc roles.**

- `vision` — product direction the plan should align with.
- `codingStandards` — a specification the plan must honor when tree prose makes
  claims it governs.
- `designSystem` — UI guidelines and inspiration, not a verbatim plan spec.
  Adherence is enforced during implementation (implementor / code-quality
  validator when the Task is UI-related), not by plan-polish
  internal-consistency.

**Consultation map.**

| Doc key | Who consults |
| --- | --- |
| `vision` | `issue-tracker-plan`, plan-polish check agents (shared bootstrap + internal-consistency cohesion), implementor bootstrap |
| `codingStandards` | implementor, code-quality validator; plan-polish internal-consistency when tree prose makes claims the doc governs |
| `designSystem` | implementor + code-quality validator when the Task appears UI-related (judgment from prose + paths; no Task flag) |

Agents load these at bootstrap; coordinators do not pass doc paths in Task
prompts.

**Subsystem vision docs (convention only).** Per-subsystem vision docs are
ordinary Project **attachments**, not additional `supportingDocs` keys. The
`supportingDocs` schema stays `{ vision?, codingStandards?, designSystem? }`
— no schema or CLI change. Index them from the main vision doc (the
`supportingDocs.vision` target) under a `## Subsystem reference` section.
Each entry is a markdown list item:

```
- <subsystem name> — <attachment:name> — <one-line scope>
```

Agents discover and consult a subsystem doc via the existing vision path:
read the vision doc, find a matching `## Subsystem reference` entry, then
Read that attachment.

**Mission paragraph (convention only).** The main vision doc (the
`supportingDocs.vision` target) may include a `## Mission` section: one
short paragraph written for an agent audience, distilled from the rest of
the doc. `issue summary` surfaces it on the Project section as a
`Mission:` line (after `Workspace:` and before `supportingDocs:`). An
absent heading means the line is omitted — not an error.

### Project workspace

A Project's optional `workspace` is the absolute path to the local git checkout
its Epics' work lands in. It is set with
`issue project set <projectId> workspace <path>` (cleared with `--clear`) and
surfaced on the Project node by both `issue project view` (a `workspace:`
line) and `issue summary` (a `Workspace:` line under the Project). Prefer
`issue project get <projectId> workspace` for a single-field read.

The field exists so the work loop's **repo-touching subagents** (git,
implementor, and both validators) know where to operate. The **model
discriminator** uses the same path for **read-only peeks** when scoring
verification difficulty (see [Model discriminator (read-only peek)](#model-discriminator-read-only-peek)).
The coordinator does no repo work and never needs a workspace. The contract
below is the single source of truth; the agent files (`agents/*.md`) and the work
skill point here rather than restating it.

**Resolution.** A repo-touching subagent reads its own bootstrap
`issue summary <id>` output — never a value inlined in its Task prompt (a
coordinator must not pass one, but if one leaks in, ignore it). From that output:

- the workspace is the `Workspace:` line under the Project;
- the project id is the id on the `Project: <id> — <title>` line (used to build
  workspace-related attention messages).

**Use as cwd.** Run **every** repo command — git, builds, tests, and any
file-edit / diff-inspection — with the workspace path as the shell working
directory (pass it as the tool's `working_directory`, or `cd` into it first);
never rely on the ambient cwd for repo work. The `issue` CLI is exempt: it
resolves its issues dir from its own install location, so it works from any cwd —
keep invoking it as-is.

**Unset → escalate, never fall back.** If `issue summary` prints no `Workspace:`
line, do **not** touch any repo. Raise
`issue epic set <epicId> needsAttention true --reason "Project workspace unset — set it with 'issue project set <projectId> workspace <path>'"`
(substituting the ids) and stop. Attention always lands on the **Epic**: a
Project carries no needs-attention fields, so it is never the target.

**Coordinator preflight.** Because the missing-workspace failure otherwise only
surfaces once a repo subagent is spawned, the work-loop coordinator checks for
the `Workspace:` line up front (in Setup) and hands back to the user before
spawning anything if it is absent.

### Project trunk

A Project's `trunk` is the default git ref for derived `mergeBase` when no
`mergeBaseOverride` applies. It is set with
`issue project set <projectId> trunk <ref>` and read with
`issue project get <projectId> trunk`. It defaults to **`main`** so existing
Projects are unaffected. Root Stories and Epics may override it via
imperative `mergeBase` (stored as `mergeBaseOverride`); first-layer Epic
Stories inherit the Epic's override — see
[stacked-PR merge model](#the-stacked-pr-merge-model).

### Model discriminator (read-only peek)

When scoring verification difficulty, the discriminator may **read-only**
inspect the workspace (file reads and greps; no edits, builds, tests, or writes)
with the workspace as cwd, solely to judge whether required patterns/APIs exist
and how hard verification will be. It does not implement, choose libraries for
the implementor, or plan the solution beyond what scoring requires. Resolve and
use the workspace via the same `issue summary` rules above; honor **Unset →
escalate** — do not peek from an ambient cwd. Exploration volume (many reads
across the tree) is not capped when needed to score accurately.

### Project merge policy

`mergePolicy` decides what happens to a Story once its last Task is `done` —
the integration steps `finish-branch` runs after pushing the Story branch. It
can be set on **Project**, **Epic**, and **Story** nodes (not Task). Project
`mergePolicy` defaults to **`manual`**, matching today's posture where a human
opens and merges PRs.

**Per-node storage.** Set with `issue project set <projectId> mergePolicy
<policy>`, `issue epic set <epicId> mergePolicy <policy>`, or `issue story set
<storyId> mergePolicy <policy>`. Project stores a required value; Epic and Story
store an optional override (absent means inherit).

**Effective policy.** Each node has an **effective** policy: its stored value
when set, otherwise inherited from its parent — Epic → Project; root Story →
Epic or Project; stacked Story → parent Story. On **get**, `issue story get
<storyId> mergePolicy` and `issue epic get <epicId> mergePolicy` return the
derived effective value; `issue project get <projectId> mergePolicy` returns
the stored Project default.

**Ceiling lattice.** At set time, `mergePolicy` patches are hard-rejected when
a node's effective policy would exceed its **ceiling** (the parent's effective
policy), or when lowering a parent would leave a descendant above the new
ceiling. The danger order is `manual < pull-request < merge < fast-forward`
(`MERGE_POLICY_RANK` in `app/server/fields.ts`). A root-level Epic or Story
with an explicit non-trunk `mergeBaseOverride` has no ceiling and instead
becomes the ceiling for its descendants; first-layer Epic Stories inherit the
Epic's base rather than carrying their own override, so they stay ceilinged by
the Epic.

The work loop **always** finishes a Story by spawning the git subagent in
`finish-branch` mode; the coordinator never reads or branches on `mergePolicy`.
Only the git subagent interprets it, from `issue story get <storyId>
mergePolicy` (the Story's effective policy), so there is exactly one reader and
the skill can never contradict the field. `finish-branch` runs in the Project
workspace (same cwd rules as above). **Push is always safe** — saving work on
the Story's own branch is harmless — so finish-branch **always pushes the Story
branch first**; `mergePolicy` selects only what happens beyond that push:

- **`manual`** — push the Story branch, then stop (no PR, no merge). A human
  opens and merges the PR later. (Default.)
- **`pull-request`** — after the push, open a **draft** PR against its derived
  `mergeBase`, then record the url via `issue story set <storyId> prUrl <url>`.
  It does **not** wait for merge or set `merged`, so the Story derives to
  `pr-open`.
- **`merge`** — after the push, merge the Story's git branch into its derived
  `mergeBase`, push that ref, and set `merged` via
  `issue story set <storyId> merged true` (Story derives to `merged`). This is
  the local, no-PR integration path. Setting `merged` does not write child
  `mergeBase` keys — children re-derive on the next read (see
  [stacked-PR merge model](#the-stacked-pr-merge-model)). When a parent lands,
  **GitHub retargets** open child PRs; the tracker only updates metadata —
  finish-branch never runs `gh pr edit --base` (or any PR retarget CLI). Then
  **flag stale children** (below).
- **`fast-forward`** — after the push, fast-forward the derived `mergeBase` to
  the Story's tip (`git merge --ff-only <branchName>`), push that ref, and set
  `merged` via `issue story set <storyId> merged true` (same end state as
  `merge`). Unlike `merge`, this lands the Story's commits directly on the base
  with no merge commit. If the base has advanced so a fast-forward is
  impossible, escalate (`needsAttention`) rather than force-merging — see
  **Failure and recovery**. Ranks highest on the merge-policy danger order (Epic
  **work-on-existing-branches**). Then **flag stale children** (below).

**Flag stale children.** A successful `merge` or `fast-forward` advances the
finishing Story's base branch `Bp`. After that push and `merged` write,
finish-branch takes `<projectId>` from the `Project: <projectId> — <title>`
line of `issue summary <storyId>`, runs `issue list story --in <projectId>`
once, and for each entry in `issues[]` reads `merged` and `branchName` from
the entry and `storyStatus` and `mergeBase` from `derived[<id>]`. It flags
every not-yet-merged Story other than the finisher whose derived
`storyStatus` is not `not-started` (skip when `branchName` is empty) and whose
derived `mergeBase` is `Bp`, via `issue story set <childId> needsRebase <Bp>`.
It never rebases those Stories. `manual` and `pull-request` do not advance a
base and never flag.

**Resumable / idempotent.** The work loop is resumable, so finish-branch may run
twice for the same Story. Before acting, the git subagent reads the Story's
`prUrl` / `merged` (via `issue story get <storyId> prUrl` /
`issue story get <storyId> merged`). When the policy's integration end state
already holds — `merged` set for `merge` or `fast-forward`, `prUrl` set for
`pull-request` — it does not open a duplicate PR or re-merge / re-push the
base. For `merge` / `fast-forward` with `merged` already set, it still runs
**flag stale children** with `Bp` = the Story's derived `mergeBase` (so a crash
between the `merged` write and flagging is recovered on resume); re-setting
`needsRebase` is harmless. **`manual`** has no metadata end state; a re-run
just re-pushes the Story branch (harmless).

**Failure and recovery.** On failure the git subagent raises attention on the
Story (`issue story set <storyId> needsAttention true --reason "…"`) and
stops. A `merge` conflict is aborted (`git merge --abort`) so the `mergeBase`
ref is never left half-merged; but a *completed* local merge whose `push`
failed is left in place — with `merged` still unset it is exactly the resumable
state above, so the retry just re-pushes. A `fast-forward` that cannot proceed
because the base advanced leaves the base untouched and escalates with a reason
that rebase is needed — never partial state.

### Project labels

A Project owns a **closed catalog** of colorful labels; Epic, Idea, and Story
issues may carry **assignments** that are ids from that catalog. Tasks and
Projects never carry assignment arrays (Project holds the catalog only).

**Catalog shape** (Project `labels`):

| field | type | notes |
| --- | --- | --- |
| `id` | kebab string | chip text; unique within the Project catalog |
| `color` | `#RRGGBB` | six hex digits only (case-insensitive) |
| `description` | string? | optional; max 120 characters when present |

**Assignments** (Epic / Idea / Story `labels`): `string[]` of catalog ids —
unique, order preserved. Multi-label. Assigning an id absent from the
containing Project's catalog is refused (labels are never created on the fly
from an issue edit). Integrity reports unknown assignment ids as problems.

**Catalog mutations** (same write as the catalog change):

- **Remove / clear** — dropping catalog entries strips those ids from every
  Epic / Idea / Story assignment in the Project.
- **Rename** (`oldId` → `newId`) — rewrites the catalog entry's `id` and
  retargets matching assignments; refused if `newId` already exists in the
  catalog (or is not kebab-safe).

**CLI.** Kind-scoped `get` / `set` only:

- Catalog: `issue project get|set <id> labels` with `--add` (JSON object upsert
  by `id`), `--remove <ids...>`, `--rename <oldId> <newId>`, `--clear`.
- Assignments: `issue epic|idea|story get|set <id> labels` with
  `--add|--remove|--clear` (and positional JSON array replace).

**Readouts.** `issue <kind> view` prints `labels: id1, id2` when non-empty
(Project: catalog ids; Epic / Idea / Story: assignment ids). `issue tree`
appends `labels=id1,id2` on Epic / Idea / Story rows when non-empty.
`issue summary` omits labels. No CLI `--label` (or similar) filter.

**`apply`.** Catalog and assignments are **imperative only**; `apply`
preserves both (same class as `workspace` / `mergePolicy` / `assignee`).

Epic — the Epic/Story/Task needs-attention common fields plus:

| field | type | notes |
| --- | --- | --- |
| `partOf` | string | the Project id (required) |
| `blockedBy` | string[] | other Epic ids in the same Project that must finish first; defaults `[]`; the only cross-Epic edge |
| `mergeBaseOverride` | string? | optional; set via imperative `mergeBase`; first-layer Stories inherit this as their derived `mergeBase` (see [stacked-PR merge model](#the-stacked-pr-merge-model)) |
| `mergePolicy` | `"merge"` \| `"pull-request"` \| `"manual"` \| `"fast-forward"`? | optional stored override; effective value derived on get (see [Project merge policy](#project-merge-policy)) |
| `retro` | `"in-progress"` \| `"done"`? | absent until set; informational record that retro ran (`in-progress` while mining, `done` after terminal comment); no workflow branches on it |
| `labels` | string[]? | assignment ids from the Project catalog; unique, order preserved (see [Project labels](#project-labels)) |

Idea — the common-to-every-kind fields plus:

| field | type | notes |
| --- | --- | --- |
| `partOf` | string | the Project id (required) |
| `archived` | boolean | defaults `false`; see [Archived visibility](#archived-visibility) |
| `labels` | string[]? | assignment ids from the Project catalog; unique, order preserved (see [Project labels](#project-labels)) |

No assignee, needs-attention, status, git fields, or chat. Leaf under a Project;
shares the Project-child `order` space with Epics and root project-level Stories.

Story — the Epic/Story/Task needs-attention common fields plus:

| field | type | notes |
| --- | --- | --- |
| `partOf` | string | the Epic id **or** Project id (required) |
| `branchName` | string? | set once the git branch is created; rename refused while stacked children exist |
| `stackedOn` | string? | single fork-point Story id (must be in the same Epic, or same Project for project-level Stories); absent => root |
| `mergeBaseOverride` | string? | optional; meaningful on project-level root Stories only; set via imperative `mergeBase` (see [stacked-PR merge model](#the-stacked-pr-merge-model)) |
| `mergePolicy` | `"merge"` \| `"pull-request"` \| `"manual"` \| `"fast-forward"`? | optional stored override; effective value derived on get — this is what `finish-branch` reads (see [Project merge policy](#project-merge-policy)) |
| `prUrl` | string? | optional |
| `merged` | boolean | defaults `false` |
| `needsRebase` | string? | optional; branch to rebase onto when a base advanced under this Story; set by finish-branch on started, not-yet-merged Stories whose derived `mergeBase` matches the advanced base after `merge` / `fast-forward` (see [Project merge policy](#project-merge-policy)); clear with `--clear`; tree chip `needsRebase=<branch>` when set |
| `specReview` | `"passed"` \| `"failed"`? | absent until set; machine-readable spec-review gate |
| `retro` | `"in-progress"` \| `"done"`? | absent until set; informational record that retro ran (`in-progress` while mining, `done` after terminal comment); no workflow branches on it |
| `labels` | string[]? | assignment ids from the containing Project catalog; unique, order preserved (see [Project labels](#project-labels)) |

Task — the Epic/Story/Task needs-attention common fields plus:

| field | type | notes |
| --- | --- | --- |
| `assignee` | string? | optional; in the work loop, overloaded as the implementor model family key (`composer`, `grok`, or `opus`) |
| `partOf` | string | the Story id (required) |
| `status` | `"todo"` \| `"in-progress"` \| `"fixing"` \| `"done"` | defaults `todo`; the only stored status |
| `qa` | `"reviewing"` \| `"changes-requested"` \| `"passed"`? | absent until set; machine-readable QA gate |
| `commitSha` | string? | set when done |
| `noDiff` | boolean? | absent until set; signals no source-controlled implementor changes |

Deliberately excluded: `rank`/priority (sibling order is stored as `order`, not
authored as a separate priority field), freeform per-issue labels outside the
Project catalog (see [Project labels](#project-labels)), inline
`description`/`messages` (they are separate files), and status history.

### Finish commit

When the work loop spawns the git subagent in `finish-commit` mode, it finalizes
one Task. The coordinator never inspects the working tree or the `noDiff` flag —
only the git subagent does. The subagent reads the Task's `noDiff` (via
`issue task get <taskId> noDiff`) and the working-tree state (`git status`),
then applies:

| `noDiff` | Tree | Action |
| --- | --- | --- |
| `true` | clean (empty) | `issue task set <taskId> status done` only — no `git commit`, no `commitSha`; leave `noDiff` set. |
| `true` | dirty | Escalate: `issue task set <taskId> needsAttention true --reason "…"` — the flag contradicts a non-empty tree. |
| absent / `false` | clean (empty) | Escalate: `issue task set <taskId> needsAttention true --reason "…"` — an empty tree without `noDiff` is not a completion signal. |
| absent / `false` | dirty | Stage all changes (`git add -A`), `git commit -m "<Task title>"`, `issue task set <taskId> status done`, `issue task set <taskId> commitSha $(git rev-parse HEAD)`. |

The `true` / clean row is a legitimate `done` outcome even when a
non-source-controlled file was edited (git status stays clean); that is not a
contradiction with `noDiff`. The implementor sets `noDiff` via kind
[`set`](#kind-scoped-get--set) (and explains why in chat) when the correct
outcome is no source-controlled file changes; validators and the git subagent
honor the flag. Clearing it (`noDiff false`) is required if a revision later
lands source-controlled file changes.

### Tree nesting and order

The tree nests a Story under the Story it forks from: a Story renders as a
child of its `stackedOn` Story (which must be in the same container — Epic, or
Project for project-level Stories), so indentation mirrors the git stack depth.
A Story with no `stackedOn` is a *root* Story, rendered directly under its
Epic, or as a Project board child when `partOf` is the Project. Under a Story,
its own Tasks render first, then the Stories stacked on it. Story order is
therefore **pure stacked depth-first** over `stackedOn` alone; `blockedBy`
plays no part in it (it is an Epic-level edge, surfaced in the Epic's detail
panel and used only to gate the Epic's derived `blocked` state — not sibling
order). Within one nesting level, siblings are ordered strictly by stored
`order` (never `createdAt` or `id`). Root Stories under an Epic (or under a
Project) are traversed depth-first (each root immediately followed by what
stacks on it); siblings at every level sort by `order`. Epics, Ideas, root
project-level Stories, and Projects sort by `order` (Epics, Ideas, and root
project-level Stories share one Project-child sibling group). Duplicate `order`
within a sibling group is an integrity problem.

**Projects scope the view.** A Project is the top-level container: every Epic,
Idea, and project-level Story is `partOf` exactly one Project. The web UI lists
Projects in a sidebar; selecting one scopes the tree to that Project's subtree
(its board children — Epics, Ideas, and root project-level Stories — plus each
Epic's or project-level Story's descendants). Projects themselves are not
rendered as nodes inside the tree — they are the selectable root. Projects are
ordered by `order`.

**Stored `order`.** Every issue carries an integer `order` within its sibling
group. Authors never write it in an apply doc — `apply` infers it from array
position (and rejects an explicit `order` key). Imperative `add` appends
(`max + 1`); reparenting without an explicit `order` patch re-appends in the new
group. Tree emission is structural DFS (each level sorted by `order`), never by
`id` or `createdAt`.

<a id="archived-visibility"></a>

### Archived visibility

Epic / Idea / Story / Task carry a stored boolean `archived` (default / absent =
`false`). Projects are never archived. Setting `archived` true or false on a
node applies the same value to all descendants (cascade). Creating a child
under any archived ancestor starts the child `archived: true`. Archiving a
child while its parent stays unarchived remains allowed. Ideas are leaves, so
archiving an Idea has no descendants to cascade to. `issue tree` and
`issue list` omit archived rows by default; pass
`--show-archived` to include them. The web UI tree uses the same filter rule:
archived rows are hidden unless the client "Show archived" preference is on
(default off; fills the former Ready view-control slot next to search). Detail
header and tree-row hover expose Archive / Unarchive actions that PATCH
`archived` through the same cascade path as CLI `set`.

## `chat.jsonl` message shape

Each line of `chat.jsonl` is one JSON message object (`app/server/schemas.ts`):

| field | type | notes |
| --- | --- | --- |
| `role` | string | non-empty; the author role (e.g. `agent`, `human`) |
| `name` | string? | optional author display name |
| `body` | string | non-empty; Markdown, may contain `issue:` links |
| `at` | ISO string | server-stamped on append (not supplied by the caller) |

Malformed lines are skipped into `problems` on read, never thrown.

## Service layer

`app/server/services/issues.ts` is the **sanctioned writer** of issue metadata
and prose under `issues/`, shared by the HTTP routes and the CLI.
`app/server/services/attachments.ts` is the sibling writer for
`issues/<id>/attachments/` (per-file get/put/remove share the same `serialize`
chain; `listAttachments` does not). All misconfiguration is prevented here, so
no consumer can persist a broken file.

### Writer contract

- `list()` — scans `issues/*/`, reads each `issue.json` (plus presence of
  `description.md`/`chat.jsonl`), runs `derive()`, and returns issues + derived
  state + all `problems`. Malformed dirs/files and malformed chat lines are
  collected into `problems`, never thrown.
- `read(id)` — returns one issue with its `description` and a content `version`.
- `create(input)` — generates the id/slug (with collision suffix) and
  timestamps, links `partOf`, and writes the dir + `issue.json` +
  `description.md`.
- `update(id, patch)` — **partial merge**, never a blind overwrite; bumps
  `updatedAt`. The mergeable fields are `title`, `assignee` (Task only),
  `needsAttention`/`attentionReason`, `archived` (Epic / Idea / Story / Task;
  cascades to
  descendants — see [Archived visibility](#archived-visibility)), `partOf`, the
  kind-specific fields (`blockedBy` for an Epic; `status`/`qa`/`commitSha`/`noDiff`
  for a Task; `branchName`/`stackedOn`/`prUrl`/`merged`/
  `specReview` for a Story), `labels` (Project catalog; Epic / Idea / Story
  assignments — see [Project labels](#project-labels)), and `description`
  (written to `description.md`). Catalog remove/clear cascades strip matching
  assignment ids project-wide in the same write; catalog rename retargets
  matching assignments in that same write. Clearable fields are removed
  when patched to `null`. A patch that names a field not valid for the issue's
  kind is rejected.
- `remove(id)` — deletes the issue and its containment subtree, repairing every
  surviving reference into it (see [Deletion policy](#deletion-policy)). Exposed
  over HTTP as `DELETE /api/issues/:id` and via `issue <kind> delete`.
- `appendMessage(id, {role, name?, body})` — appends one JSONL line to
  `chat.jsonl` with a server-stamped `at` (`issue epic|idea|story|task comment`
  and chat HTTP share this path).
- `readChat(id)` — reads/parses `chat.jsonl`, skipping malformed lines into
  `problems`. An issue with no chat file returns empty messages.
- Attachment bytes (`attachments.ts`): `listAttachments` / `getAttachment` /
  `putAttachment` (unique name on collision) / `removeAttachment` — see
  [Attachments](#attachments). Not part of `read(id)` payloads.

### Cross-cutting guarantees

- **Validate-at-write.** `create`/`update` run the integrity checks against the
  *prospective* state and refuse any write that would introduce a `problem` — a
  bad or missing `partOf`/`stackedOn`/`blockedBy` referent, a referent of the
  wrong kind (a Task's `partOf` must be a Story, a Story's an Epic or a
  Project, an Epic's or Idea's a Project; a `stackedOn` must be a Story, a
  `blockedBy` entry an Epic), a `stackedOn` in a different container (Epic or
  Project), a `blockedBy` Epic in a different Project, a cycle-inducing
  `stackedOn`/`blockedBy`, or an Epic / Idea / Story `labels` id absent from
  the containing Project catalog. On failure the CLI exits nonzero with a clear
  message and HTTP returns 4xx with detail.
- **Read-time validation.** Hand-edited or out-of-band files are still validated
  on read and surfaced as `problems`; they never crash a read. A directory whose
  `issue.json` id disagrees with the directory name is reported as a problem.
- **Serialized writes.** A single in-process promise chain serializes all writes
  so concurrent CLI/HTTP calls cannot race.
- **Change detection.** `read` returns a `version` (a hash over `issue.json` +
  `description.md`) so the UI can detect out-of-band edits to the open issue.
  `chat.jsonl` and `attachments/` are deliberately excluded from the version so
  chat appends and attachment uploads/deletes do not trip the external-edit
  banner.

### Deletion policy

Deleting an issue must leave the remaining graph valid — no dangling
`partOf`/`stackedOn`/`blockedBy` and no new problem. `remove()` computes the
outcome with the pure, filesystem-free `planDeletion()`
(`app/server/services/deletion.ts`), validates the prospective surviving set,
and only then persists repairs and removes directories, so a deletion that could
not leave the graph valid is refused without side effects.

**Cascade by deleted kind (the `partOf` containment closure — the "delete
set"):**

- **Task** — removes only that Task (Tasks have no children).
- **Story** — removes the Story and every Task `partOf` it.
- **Idea** — removes only that Idea (Ideas have no children).
- **Epic** — removes the Epic, every Story `partOf` it, and every Task
  `partOf` those Stories (transitive). Does **not** remove project-level
  Stories (they are `partOf` the Project, not the Epic).
- **Project** — removes the Project and its entire subtree: every Epic, Idea,
  and project-level Story `partOf` it, every Story `partOf` those Epics, and
  every Task `partOf` those Stories (transitive). Deleting a Project therefore
  discards all of its work; the UI gates this behind a confirmation dialog that
  names the contained-issue count.

**Foreign-reference resolution.** After the delete set is computed, every
surviving issue (across all Projects, not just descendants) is scanned for edges
into it, and each edge type resolves deterministically:

| edge into delete set | resolution |
| --- | --- |
| `partOf` | Cannot survive — the referrer is itself contained, so it is already in the delete set. No repair needed. |
| `stackedOn` (a deleted Story; always same container) | **Splice**: repoint the surviving Story to the deleted story's own `stackedOn`, walking up until a surviving Story, or absent (forks the Project trunk) if none. The next read re-derives `mergeBase` from the new topology (see [stacked-PR merge model](#the-stacked-pr-merge-model)). Preserves the stack minus the removed node. |
| `blockedBy` (a deleted Epic; cross-Epic, same Project) | **Drop**: remove the deleted Epic id from the blocked Epic's list, with no inheritance. This is the case that matters for Epic deletion, since `blockedBy` is the only edge that crosses an Epic boundary. |
| `stackedOn` → a deleted Task/Epic, or `blockedBy` → a deleted Story/Task | Impossible — `stackedOn` only ever references a Story, and `blockedBy` only ever references an Epic. |

`issue:` cross-links inside `description.md` are freeform Markdown, not
validated relationships, so they are left untouched.

Deleting an issue removes its whole directory (`rmSync` recursive), so any
`attachments/` under that directory go with it — both imperative `remove` and
`apply` prune. There is no separate attachment-cascade step.

**Invariant.** After `remove()`, `list().problems` gains no new
dangling-reference, wrong-kind, or cycle problem — guaranteed by construction in
`planDeletion()` and re-validated against the surviving set before any write.

## Attachments

Opaque files that travel with an issue (e.g. Cursor Canvases as `.tsx`, images,
small fixtures, Project supporting docs). Owned by
`app/server/services/attachments.ts`, a sibling writer whose per-file
get/put/remove share the same `serialize` chain as `issues.ts` writes;
`listAttachments` is unsynchronized.

**Kinds.** Attach / list / download / detach on every kind with the attachments
capability. Unknown ids are refused.

**On-disk.** `issues/<id>/attachments/<basename>` — no manifest; metadata is
filename + size + mtime, with MIME inferred from the extension
(`application/octet-stream` when unknown).

**Limits.** Path-safety only: reject empty names, `.`, `..`, `/`, `\`, null
bytes, and any name that is not a plain basename. No extension allowlist.
**25 MiB** max per file (`MAX_ATTACHMENT_BYTES`).

**Unique names.** `putAttachment` stores under a collision-free basename: the
requested basename when free, otherwise `{stem}-{n}{ext}` with the smallest
`n ≥ 2` not already taken (stem + last extension). Existing files are never
overwritten. Removal is explicit (`removeAttachment` /
`issue <kind> detach` / `DELETE`). There is no rename verb —
attach under the desired basename and detach the old name.

**HTTP** (thin adapter over the service; payloads are not embedded in
`GET /api/issues/:id`):

| method | path | behavior |
| --- | --- | --- |
| `GET` | `/api/issues/:id/attachments` | list metadata |
| `POST` | `/api/issues/:id/attachments` | multipart `file` upload; requested name = basename of uploaded filename; on collision store under a unique name; response returns the stored name |
| `GET` | `/api/issues/:id/attachments/:name` | download bytes + `Content-Type` |
| `DELETE` | `/api/issues/:id/attachments/:name` | remove one file |

**Description links.** Issue-local relative Markdown only. A link like
`[foo](foo.tsx)` means that issue's `attachments/foo.tsx`. Arbitrary external
workspace paths remain forbidden. Convention + docs/skills only — there is no
integrity check that the linked file exists.

**`apply`.** Never creates, updates, or deletes attachment bytes (same seam as
`chat.jsonl`). Rewriting `description.md` via apply leaves attachments
untouched; only deleting the issue (or apply-pruning it) removes them.

## `apply` doc format

`apply` (`app/server/services/apply.ts`, schema in `apply-schema.ts`) is the
**declarative writer**: it reconciles a subtree from one nested YAML doc,
complementing the imperative one-shot verbs. The doc may be rooted at a Project,
an Epic, or a Story, so a single `apply` can own a whole project, one epic, or
one story's task list. Authoring guidance lives in
[issue-tracker-authoring](skills/issue-tracker-authoring/SKILL.md); this section
is the format + semantics reference.

### Shape

The most common doc describes one Project subtree. Every nest uses a single
key — `children:` — and every `children:` entry carries an explicit `kind`.
Root nodes omit `kind` (the form key `project` / `epic` / `story` implies it).
Allow-lists: Project → `epic | idea | story`; Epic → `story`; Story →
`task | story`. Under a Story, `kind: story` means a stacked Story (`stackedOn`
that Story, `partOf` the same container as the fork point — Epic or Project).

```yaml
project:
  id: my-product              # author-chosen kebab id (required on every node)
  title: My Product
  description: |              # optional inline block scalar -> description.md
    Overview prose.
  children:
    - kind: idea
      id: future-work
      title: Future work
      description: |
        Capture item — mined later into an Epic or Story.
    - kind: story
      id: solo-story           # project-level Story (partOf the Project)
      title: Solo Story
      description: |
        Single-unit plan — no Epic wrapper.
      children:
        - kind: task
          id: solo-task
          title: Solo task
    - kind: epic
      id: my-epic
      title: My Epic
      description: |
        Cross-cutting invariants.
      blockedBy: [other-epic]  # other Epics (same Project) that must finish first
      children:
        - kind: story
          id: base-story       # root Story (no stackedOn) -> trunk or Epic mergeBaseOverride
          title: Base Story
          description: |
            This unit's full prose.
          children:
            - kind: task
              id: first-task
              title: First task
              description: |
                Implementor-resolution detail + how to verify.
            - kind: story      # stacked on base-story; partOf my-epic
              id: follow-up
              title: Follow-up
              children:
                - kind: task
                  id: follow-up-task
                  title: Follow-up task
```

- **`children:` + `kind` only.** `children:` is the only nest key. Every entry
  under it declares `kind`. Ideas are leaves (no nested `children`). Prefer an
  Epic when authoring stacks or sibling root Stories.
- **No dual-key / legacy keys.** Project `epics:` is **not** accepted — use
  `children:` with `kind: epic | idea | story` (refused with
  `project "epics:" is no longer accepted; use "children:" with kind: epic | idea | story`).
  Nested `stories:` / `tasks:` / `stacked:`, `branches` / `commits`, and a
  rooted `branch:` are also **not** accepted — there is no alias period.
  Legacy nest keys fail as ordinary strict unknown keys. Migrate apply docs to
  `children:` + `kind` and rooted `story:`; rooted `branch:` is refused with an
  explicit error (`"branch:" is no longer accepted; use "story:"`).
- **Inferred `partOf`.** Each node's containment is its enclosing container (a
  Task's Story; a Story's Epic, or the Project for a project-level Story; an
  Epic or Idea's Project). A stacked Story (`kind: story` under another Story)
  stays `partOf` that same container — not the fork-point Story. Never written
  in the doc.
- **Inferred `stackedOn`.** A Story nested under another Story's `children:`
  with `kind: story` forks from it; a Story directly under a Project or Epic
  `children:` list is a root / first-layer Story (derived `mergeBase` =
  `mergeBaseOverride` or Project `trunk` — see
  [stacked-PR merge model](#the-stacked-pr-merge-model)). Never written in the
  doc.
- **Order groups stay separate.** Under a Story, Task `order` and stacked-Story
  `order` renumber independently (YAML interleaving does not create one shared
  sequence). UI still shows tasks then stacked Stories.
- **Explicit `blockedBy`.** The one cross-reference authored by hand: on an
  **Epic** node, a list of other Epic ids (same Project) this Epic depends on.
  Uses the same kebab id rule as node ids. Omitting `blockedBy` on a restated
  Epic sets it to `[]` — the doc is the full desired state for that field, not
  a patch over on-disk edges. That is distinct from "unchanged nodes are
  untouched" (whole node already matches the doc) and from the story-rooted
  rule that preserves on-disk `stackedOn` when unrestated.
- **Inline descriptions.** Each node's optional `description` is a block scalar
  (`|`) written to that issue's `description.md`; omitting it on create seeds the
  default `# <title>`. This is what lets authors write Markdown without shell
  escaping.
- **Author-chosen ids** on every node (see the [id model](#on-disk-layout)):
  required, kebab, unique across the doc, slug-safe, title-independent.

### Rooted forms: epic and story scope

A project doc reconciles the whole project, so it prunes every Epic, Idea, and
project-level Story the doc omits from `children:`. To edit a single epic or
story without disturbing its siblings, root the doc at that node and name the
enclosing parents by **id** (a reference — never upserted, never pruned).
Epic- and story-rooted docs never include Ideas (or other Project board
siblings) in scope, so those forms leave them untouched:

```yaml
# Epic form: reconciles just my-epic within an existing project.
project: my-product        # existing project id (reference)
epic:
  id: my-epic
  title: My Epic
  blockedBy: [ ... ]       # other Epic ids (same Project) that must finish first
  children: [ ... ]        # kind: story entries; same nest shape as above
```

```yaml
# Story form (Epic child): reconciles just my-story + its tasks within an
# existing epic.
project: my-product        # existing project id (reference)
epic: my-epic              # existing epic id (reference)
story:
  id: my-story
  title: My Story
  children: [ ... ]        # kind: task only
```

```yaml
# Story form (project-level): omit `epic:` — Story's partOf is the Project.
project: my-product        # existing project id (reference)
story:
  id: solo-story
  title: Solo Story
  children: [ ... ]        # kind: task only
```

- **Form by root key.** An object `project` is the project form; a string
  `project` + object `epic` is the epic form; string `project` + object `story`
  is the story form (optional string `epic` scopes the Story under that Epic;
  omit `epic` for a project-level Story).
- **Parents must exist.** The referenced parent(s) must already be on disk with
  the right kind and containment (the epic must be in the project; a
  pre-existing root node must already sit under the declared parent), else the
  doc is refused. A story form without `epic:` refuses when the Story's on-disk
  `partOf` is an Epic (use the epic-scoped form instead).
- **Story scope is story + tasks only.** Stacked Stories (`kind: story` under a
  Story) are `partOf` the *container* (Epic or Project), not the story, so they
  fall outside a story's subtree. A story-rooted doc may nest only `kind: task`
  children; `kind: story` there is refused. Stacked Stories stay in the parent
  Epic/Project apply scope.
- **Fork point preserved.** `stackedOn` is normally inferred from nesting, but a
  story-rooted doc has no parent nesting, so it **preserves the on-disk
  `stackedOn`** rather than clearing it — a story doc never moves the fork point.

### Semantics

- **Upsert.** A node whose id exists (within the declared root's subtree) is
  updated; a new id is created. Ids are matched, not titles, so retitling a node
  in the doc renames its `title` in place rather than creating a duplicate.
- **Prune by default.** Any issue in the declared root's on-disk subtree that
  the doc no longer lists is deleted. `apply` is therefore the full desired state
  of that root's subtree, not a patch. (An out-of-scope `blockedBy` edge into a
  pruned Epic is dropped, mirroring the [deletion policy](#deletion-policy).)
- **Atomic + validated.** The entire prospective set is run through
  `checkIntegrity` in one pass before any write; a doc that would introduce a
  problem (dangling/wrong-kind referent, cross-Epic `stackedOn`, cycle, duplicate
  or non-slug id, or an id that already exists outside the declared root's
  subtree) is refused with no on-disk change. Same validator, same guarantees as
  the imperative writer.
- **Idempotent.** Re-applying an unchanged doc rewrites nothing (unchanged nodes
  keep their `updatedAt`), so it is safe to re-`apply` an evolving plan. The one
  exception is **stale-key reconciliation:** if an on-disk `issue.json` carries a
  key the current schema no longer recognizes (e.g. a pre-migration story-level
  `blockedBy`, which `parseIssue` strips on read), a re-apply rewrites that file to
  tidy the stale key and counts it as `updated`. Since this is not a semantic
  change, the node keeps its existing `updatedAt`.

### Declarative/imperative field seam

`apply` owns only **plan shape + prose** and must **never** touch runtime state.
This is enforced in `buildIssue`, which reads the doc for its owned fields and
preserves everything else from the existing same-kind issue.

| field | writer |
| --- | --- |
| `title` | `apply` (from the doc) |
| `description` (`description.md`) | `apply` (from the doc) |
| `blockedBy` (Epic) | `apply` (from the Epic node; omit → `[]`) |
| `retro` (Epic) | imperative only (kind [`set`](#kind-scoped-get--set)); `apply` preserves |
| `retro` (Story) | imperative only (kind [`set`](#kind-scoped-get--set)); `apply` preserves |
| `workspace` (Project) | imperative only (kind [`set`](#kind-scoped-get--set)); `apply` preserves |
| `mergePolicy` (Project) | imperative only (kind [`set`](#kind-scoped-get--set)); `apply` preserves |
| `mergePolicy` (Epic / Story) | imperative only (kind [`set`](#kind-scoped-get--set)); `apply` preserves; effective value derived on get |
| `supportingDocs` (Project) | imperative only (kind [`set`](#kind-scoped-get--set)); `apply` preserves |
| `labels` (Project catalog) | imperative only (kind [`set`](#kind-scoped-get--set)); `apply` preserves |
| `labels` (Epic / Idea / Story assignments) | imperative only (kind [`set`](#kind-scoped-get--set)); `apply` preserves |
| `kind` | explicit on every `children:` entry (allow-lists above); omitted on root nodes (form key implies kind) |
| `partOf`, `stackedOn` | inferred from nesting (a story-rooted doc has no nesting, so it preserves the on-disk `stackedOn`); runtime `partOf`/`stackedOn` edits use kind [`set`](#kind-scoped-get--set) |
| `id`, `createdAt` | set on create; `apply` preserves them, never rewrites |
| `status`, `qa`, `commitSha`, `noDiff` (Task) | imperative only (kind [`set`](#kind-scoped-get--set)); `apply` preserves |
| `branchName`, `prUrl`, `merged`, `specReview`, `retro` (Story) | imperative only (kind [`set`](#kind-scoped-get--set)); `apply` preserves |
| `mergeBaseOverride` (Epic / Story) | imperative only via kind [`set`](#kind-scoped-get--set) field `mergeBase` (stores as `mergeBaseOverride`); `apply` preserves |
| `mergeBase` (Story) | derived on get only — never stored; resolver layers `mergeBaseOverride` / `trunk` / stack topology (see [stacked-PR merge model](#the-stacked-pr-merge-model)) |
| `assignee` (Task) | imperative write (kind [`set`](#kind-scoped-get--set)); read via kind [`get`](#kind-scoped-get--set); `apply` preserves |
| `needsAttention`/`attentionReason` (Epic / Story / Task) | imperative write (kind [`set`](#kind-scoped-get--set); `attentionReason` only via `needsAttention` + `--reason`); read via kind [`get`](#kind-scoped-get--set); `apply` preserves |
| `chat.jsonl` | imperative only (`issue epic|story|task comment`); `apply` never reads or writes it |
| `attachments/` | imperative only (HTTP or `issue <kind> attach` / `detach`); `apply` never reads or writes attachment bytes |

So authoring/decomposition is declarative through `apply`, while working the
stack (progress, git facts, escalation, chat, attachments) stays on the
kind-scoped ops — the two never fight over a field.

## Derived state

`derive(issues)` (`app/server/services/derive.ts`) is a pure function (no
filesystem) that, given all issues, computes state that is **never stored** and
so cannot drift:

- **Task `blocked`** — a `todo` Task is `blocked` unless its Story
  (`partOf`) exists with a `branchName` and is not merged, and all earlier
  sibling Tasks (by sequence) are `done`.
- **Story mergeBase** — see [stacked-PR merge model](#the-stacked-pr-merge-model).
- **Story status** — `merged` if `merged`; else `pr-open` if it has Tasks,
  all are `done`, and `prUrl` is set; else `in-progress` if `branchName` is set;
  else `not-started`.
- **Story `blocked`** (to start) — a `not-started` Story is `blocked` when it
  has a `stackedOn` parent whose tip cannot be forked yet: the parent must have
  a `branchName` **and** all the parent's Tasks must be `done` (it forks the
  parent's tip, so there is no merge gate). A root Story (no `stackedOn`) is
  never blocked by stacking.
- **Epic status** — `done` when it has Stories and all are `merged`;
  `in-progress` if any Story has started; else `todo`.
- **Epic `blocked`** — an Epic is `blocked` while any Epic in its `blockedBy` is
  not yet `done` (a blocker is `done` only when it has Stories and all are
  `merged` — so a blocker Epic with **zero Stories is never `done`**, and
  pointing `blockedBy` at an empty Epic blocks the dependent indefinitely).
  Epic `blocked` does **not** cascade onto descendant Stories'/Tasks' own
  `blocked` flags — `tree`/`list` still show per-node stacking/sibling blocking
  under a blocked Epic.
- **problems** — the integrity checks `derive()` runs over the parsed issues:
  dependency cycles over `stackedOn`/`blockedBy`; dangling
  `partOf`/`stackedOn`/`blockedBy` ids; a Story whose `stackedOn` entry is not a
  Story, or an Epic whose `blockedBy` entry is not an Epic; a Story whose
  `stackedOn` is in a different container (Epic or Project), or an Epic whose
  `blockedBy` names an Epic in a different Project (`stackedOn` stays within one
  container; `blockedBy` stays within one Project); a Task whose `partOf` is not
  a Story; a Story whose `partOf` is not an Epic or a Project; an Idea whose
  `partOf` is not a Project; and an Epic whose `partOf` is not a Project. These
  are only the *derive-time* problems; the
  `problems` array returned by `list()` also includes the *read-time* problems
  raised while loading files (malformed or missing `issue.json`, an id that
  disagrees with its directory name, and malformed `chat.jsonl` lines — see the
  [writer contract](#writer-contract) and [glossary](#derived-terms)).

## Agent model resolution

**Canonical rule.** Subagent model resolution — frontmatter `model:` vs
spawn-time selection, ID forms, and how to verify the effective model — is
defined in the Project **`codingStandards`** supporting doc, section **Subagent
model resolution** under **Skills and Subagents** (see [Project supporting
docs](#project-supporting-docs)). That text is the standing rule; this SPEC does
not restate it. Authoring or spawning code that touches model selection should
consult that section rather than duplicating it.

**`agents/` layout.**

- A file under `agents/` with YAML frontmatter is a **Task-spawnable
  subagent** — the kind coordinators spawn via Task / `subagent_type`.
- A file whose basename starts with `_` and has **no** YAML frontmatter is a
  **shared include**: not spawnable on its own. Spawnable agents **Read** it
  from disk by absolute path; a markdown link alone is not enough.

## Design rationale

**Directory-per-issue is the source of truth (no database).** Issues are plain
files an agent, a human, or git can read and diff. There is no schema migration,
no server required to inspect state, and the on-disk tree *is* the data model.
`description.md`, `chat.jsonl`, and `attachments/` are discovered by convention
from the id (no path fields in `issue.json`), so metadata cannot point at a
missing file. Markdown links into `attachments/` are a separate convention and
may dangle — see [Attachments](#attachments).

<a id="parent-prose-must-not-restate-descendant-lists"></a>

**The complete design lives distributed across tiers.** The Epic replaces a
giant plan/spec only when the whole design is captured in the tree: overview and
cross-cutting invariants in the Epic, standalone unit prose in each Story,
implementor-resolution detail in each Task. Companion material belongs **with
the issue that uses it** — inlined in `description.md` or attached beside it
(link rules in [Attachments](#attachments)). Verbatim copy into the Epic with
empty children is not sufficient — distribution and a completeness pass are
what make the tracker a standalone basis for a future implementor. A parent's
`description.md` MUST NOT enumerate or restate the specific work its children
individually cover. Parent prose carries scope, approach, cross-cutting
invariants, and context; the *enumeration of units* is the child list itself
(Project → its Epics, Ideas, and project-level Stories; Epic → its Stories;
Story → its Tasks) — not a mirrored per-child checklist in the parent. Children
get pruned or reshaped during plan cleanup, so a parent that mirrors them
drifts into orphan claims.

**A validated service layer is the only writer.** The CLI (for agents) and the
HTTP routes (for the UI) are thin adapters over `services/issues.ts` (and
`services/attachments.ts` for attachment bytes). Every write goes through the
same validation, partial-merge, and serialization, so an issue cannot be left
in a broken state regardless of who wrote it. Integrity is enforced at the
source rather than trusted at each call site.

**Derived, not stored.** Anything that can be computed from the whole set —
Story/Epic status, `blocked`, `mergeBase` — is computed by the pure `derive()`
and never written to disk. Stored duplicates of derived facts are the classic
source of drift; by refusing to store them, the tracker cannot show a status
that disagrees with reality. A Task's `status` (the one genuine human/agent
decision) and sibling `order` (authored implicitly via doc position or
imperative append) are stored.

**Metadata-only with respect to git.** The tracker never shells out to git or
gh. Agents run git/gh themselves and record the results — `branchName`, `prUrl`,
`commitSha`, `merged` — through the CLI. The tracker's job is to model the
stacked-PR *plan* and its progress, not to drive git. This keeps it safe to run
anywhere and impossible for it to corrupt a repo.

**Correct-by-construction over defensive layering.** Malformed files and
integrity violations become `problems` that are surfaced in the UI and CLI, not
errors that are swallowed or states that are silently repaired. A write that
would introduce a problem is refused up front.
