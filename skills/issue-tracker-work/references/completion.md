# Completion

Completion has two phases. Phase 1 can finish while Phase 2 is still waiting
(e.g. under `pull-request` / `manual` before humans merge). Do not treat Phase 1
alone as “fully finished” for retro purposes.

### Phase 1 — Task-done summary

The Story walk ends when every Task under the work root is `done`. Give a short
final summary: which Stories were built, and anything still open or escalated
(needsAttention escalation). For validator findings and revise history, point the user
at the tracker comments (`issue <kind> view <id> --chat`) rather than collecting them
into your context. Note
how finished Stories landed from the `issue tree` chips (`pr=` for an opened
PR, `merged` for a merged Story, neither when left for the human).

### Phase 2 — Retro gate

Distinct coordinator hook after the Story walk — **not** part of Close-Story.
Re-read `issue tree <rootId>`. Spawn
`issue-tracker-retro` only when **all** of the following hold:

1. The walk has **at least one** Story (a zero-Story Epic must not spawn
   retro — same non-vacuous rule as derived Epic `done`). A project-level Story
   root always satisfies this (the root itself is a Story).
2. **Every** Story in the walk carries the `merged` chip (Epic: all Stories
   under the Epic; project-level Story: that Story and any stacked Stories in
   the walk). Detect from those chips only — do not guess from merge policy or
   finish-branch outcomes. Under `merge` policy this usually follows the last
   finish-branch; under `pull-request` / `manual` it runs only after humans (or
   later process) have set every Story merged.
3. Work-root `retro` is **unset** (empty stdout):
   `issue <rootKind> get <rootId> retro` (bound in Preflight step 3). If the
   field is set (`in-progress` or `done`), skip — retro already started or
   finished for this root. Do **not** check chat roles for this gate. Do
   **not** require promoting a project-level Story to an Epic before retro.

When the gate holds, spawn **once** with Cursor Task `model`
`cursor-grok-4.5-high-fast` (Models table) and the retro spawn stub (source
work-root id + title). Wait until the Cursor Task finishes (or raises
needsAttention). Do **not** mine transcripts yourself, and do **not** expect
or relay a retro summary into your context. If the gate fails only because some
Story is not `merged` yet, skip the spawn; a later re-run of this skill on the
same root re-evaluates Phase 2 once the chips show all merged (an unset
`retro` field is the sole Completion re-run guard).

Everything lives on disk and every derived fact is recomputed on read, so the
loop is **resumable** for unambiguous gates: re-running the skill on the work
root re-reads `issue tree <id>`, continues from the first not-`done` Task,
and the Per-Task **entry gate** branches on `needsAttention` / `qa` (`passed`
→ finalize, `reviewing` → resume code-quality, `changes-requested` → revise
rather than Mode `implement`). Cold-restart windows that disk cannot
disambiguate are listed under that entry gate — do not claim they are fully
handled (or, when all Tasks are already `done`, continue from Completion
Phase 2 above).
