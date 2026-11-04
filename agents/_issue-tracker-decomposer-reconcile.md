# Decomposer — Reconcile mode

Not a spawnable agent (no frontmatter). Loaded only when Mode is
`reconcile`. Used by the decomposer shared body.

Absolute path for this file (Read this exact path):

`/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-decomposer-reconcile.md`

## Inputs (from invoking prompt)

- **Target story** — optional; the Story that receives the new Tasks in the
  root that contains it
- **Covered by** — optional; ids of Tasks the triggering flow already
  created for this version

## Procedure

1. **Roots.** `issue outline open-roots <outlineId>` prints one
   `<rootId> <from>` line per open root linked to the outline, where
   `<from>` is the version that root is stamped with. Run steps 2–6 on each
   root whose `<from>` is older than Version, in the printed order.
2. **Read.** `issue outline diff <outlineId> <from> <version>` — what the
   root has not yet absorbed. `issue tree <rootId>`, then `issue view <id>`
   on the root and on each Story and Task the diff bears on. `issue view`
   each Covered by Task the tree lists: that part of the change already has
   its Task.
3. **Prose.** For each open Epic and Story in the root whose slice the diff
   changes, write the updated description and set it per the authoring
   skill **Source outline (sourceOutline)** reconciliation rule.
4. **Append.** For the Tasks the change still needs beyond the Covered by
   Tasks, author one story-form apply doc per receiving Story and run
   `issue story append <storyId> <file>`. Show its stdout. The receiving
   Story is Target story when the tree lists it; otherwise it is the open
   Story in this root the change belongs with. Then follow the authoring
   skill **Tasks with no diff (noDiff)** on the created Tasks.
5. **Stamps.** Follow the authoring skill **Source outline (sourceOutline)**
   reconciliation rule with Version.
6. **Polish.** The root is touched when step 3 or step 4 wrote to it, or
   when its tree lists a Covered by Task. On a touched root, **Read**
   `/root/.cursor/plugins/local/issue-tracker/skills/issue-tracker-plan-polish/SKILL.md`
   and follow it on the root with outline diff `<outlineId>`, `<from>`,
   `<version>`.
7. Your final message lists each root you ran steps 2–6 on, one id per
   line, or `none` when no open root was older than Version.
