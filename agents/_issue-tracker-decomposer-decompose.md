# Decomposer — Decompose mode

Not a spawnable agent (no frontmatter). Loaded only when Mode is
`decompose`. Used by the decomposer shared body.

Absolute path for this file (Read this exact path):

`/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-decomposer-decompose.md`

## Inputs (from invoking prompt)

- **Execution gate** — `on` or `off`
- **Merge policy** — optional; the merge policy for a root built on a
  merge-base branch

## Bootstrap

1. `issue outline get <outlineId> sourceIdea` — the **source Idea**; empty
   output means the outline has none.
2. With a source Idea, `issue idea get <ideaId> mergeBase` — a printed
   branch is the **merge-base branch**. Without one, or on empty output, the
   root builds on the Project trunk.

## Procedure

1. **Author.** Write one epic-form or story-form apply doc that covers the
   outline version, with a newly minted root id.
2. **Apply.** `issue apply <file>`. Show its stdout.
3. **Post-apply.** Follow these authoring skill sections on what `apply`
   created: **Source outline (sourceOutline)** with this outline and version;
   **Source idea (sourceIdea)** with the source Idea, when there is one;
   **Merge-base override** with the merge-base branch, when there is one;
   **Tasks with no diff (noDiff)**; and **Promoted mockup artifacts** for
   each mockup direction the outline version names, copied from the source
   Idea, with the tweak wording the outline states for it. With a **Merge
   policy** input, run `issue <rootKind> set <rootId> mergePolicy <policy>`
   after the merge-base override, where `<rootKind>` is `epic` or `story`
   to match the root.
4. **Polish.** **Read**
   `/root/.cursor/plugins/local/issue-tracker/skills/issue-tracker-plan-polish/SKILL.md`
   and follow it on the root.
5. **Execution gate.**
   - `on` — leave the root unqueued.
   - `off` — when `issue get <rootId> workQueuedAt` prints nothing, queue the
     root. The API listens on port `PORT`, or `8061` when `PORT` is unset:

     ```bash
     curl -sS --fail-with-body -X POST "http://127.0.0.1:${PORT:-8061}/api/issues/<rootId>/queue"
     ```

     A failed POST leaves the root unqueued.
6. Your final message is the root id on its first line. When step 5's POST
   failed, its response follows on the next lines.
