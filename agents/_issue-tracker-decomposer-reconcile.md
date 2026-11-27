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
- **Source idea** — optional, given only with Target story; the Idea whose
  plan this version carries

## Procedure

1. **Pending appends.** `issue outline get <outlineId> pendingAppends`
   prints a JSON list of `{ targetStory, sourceIdea, executionGate,
   codeApprovalRequired }`, or nothing when no append is pending. Steps 3–8
   treat each entry's `targetStory` as a Target story whose Source idea is
   that entry's `sourceIdea`. `issue view` each entry's `sourceIdea`.
2. **Roots.** `issue outline open-roots <outlineId>` prints one
   `<rootId> <from>` line per open root linked to the outline, where
   `<from>` is the version that root is stamped with. Before that loop,
   `issue summary <outlineId>`. When that summary lists a held capture,
   **Read**
   `/root/.cursor/plugins/local/issue-tracker/skills/issue-tracker-plan/references/migrate.md`
   once. Run steps 3–8 on each root whose `<from>` is older than
   Version, in the printed order. That summary decides step 6 on every
   root.
3. **Read.** `issue outline diff <outlineId> <from> <version>` — what the
   root has not yet absorbed. `issue tree <rootId>`, then `issue view <id>`
   on the root and on each Story and Task the diff bears on. `issue view`
   each Covered by Task the tree lists: that part of the change already has
   its Task.
4. **Prose.** For each open Epic and Story in the root whose slice the diff
   changes, write the updated description and set it with
   `issue <kind> set <id> description --file <path>`, following the outline
   linking rule in the authoring skill section **Source outline
   (sourceOutline)**.
5. **Append.** For the Tasks the change still needs beyond the Covered by
   Tasks, author one story-form apply doc per receiving Story and run
   `issue story append <storyId> <file>`. Show its stdout. The receiving
   Story for a Source idea's Tasks is its Target story when the tree lists
   it; otherwise it is the open Story in this root the change belongs with.
   Then follow the authoring skill **Tasks with no diff (noDiff)** on the
   created Tasks.
6. **Captures.** When the step 2 summary lists a held capture, follow
   **Held captures** for this root. When it lists none, for each Source
   idea follow the authoring skill **Promoted mockup artifacts** for each
   mockup direction the diff names, copied from that Source idea, with the
   tweak wording the outline states for it.
7. **Stamps.** Follow the authoring skill **Source outline (sourceOutline)**
   reconciliation rule with Version.
8. **Polish.** The root is touched when step 4, step 5, or step 6 wrote to
   it, or when its tree lists a Covered by Task. On a touched root, **Read**
   `/root/.cursor/plugins/local/issue-tracker/skills/issue-tracker-plan-polish/SKILL.md`
   and follow it on the root with outline diff `<outlineId>`, `<from>`,
   `<version>`.
9. **Finish.** Once every root has finished step 8:
   - For each step 1 entry, run
     `issue outline apply-append <outlineId> <sourceIdea>`. It applies that
     append's gates to its target Story and drops the entry.
   - With a Source idea input, run `issue idea set <ideaId> archived true`.
10. Your final message lists each root you ran steps 3–8 on, one id per
    line, or `none` when no open root was older than Version.
