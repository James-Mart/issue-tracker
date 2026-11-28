# Decomposer — Decompose mode

Not a spawnable agent (no frontmatter). Loaded only when Mode is
`decompose`. Used by the decomposer shared body.

Absolute path for this file (Read this exact path):

`/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-decomposer-decompose.md`

## Inputs (from invoking prompt)

- **From** — optional; a saved outline version. With it, the new root
  covers the diff from that version through Version.
- **Merge policy** — optional; the merge policy for a root built on a
  merge-base branch

## Bootstrap

1. `issue outline get <outlineId> sourceIdea` — the **source Idea**; empty
   output means the outline has none.
2. With a source Idea, `issue idea get <ideaId> mergeBase` — a printed
   branch is the **merge-base branch**. Without one, or on empty output, the
   root builds on the Project trunk.

## Procedure

1. **Author.** With **From**, `issue outline diff <outlineId> <from>
   <version>` is what the new root covers. Without **From**, the outline
   version from bootstrap is what it covers. Write one epic-form or
   story-form apply doc for that coverage, with a newly minted root id.
2. **Apply.** `issue apply <file>`. Show its stdout.
3. **Post-apply.** Follow these authoring skill sections on what `apply`
   created: **Source outline (sourceOutline)** with this outline and version;
   **Source idea (sourceIdea)** with the source Idea, when there is one;
   **Merge-base override** with the merge-base branch, when there is one;
   and **Tasks with no diff (noDiff)**. Then **Read**
   `/root/.cursor/plugins/local/issue-tracker/skills/issue-tracker-plan/references/migrate.md`
   and follow **Promoted mockup artifacts** for this outline. With a
   **Merge policy** input, run
   `issue <rootKind> set <rootId> mergePolicy <policy>` after the
   merge-base override, where `<rootKind>` is `epic` or `story` to match
   the root.
4. **Polish.** **Read**
   `/root/.cursor/plugins/local/issue-tracker/skills/issue-tracker-plan-polish/SKILL.md`
   and follow it on the root.
5. Your final message is the root id on its first line.
