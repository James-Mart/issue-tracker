# Decomposer — Update mode

Not a spawnable agent (no frontmatter). Loaded only when Mode is
`update`. Used by the decomposer shared body.

Absolute path for this file (Read this exact path):

`/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-decomposer-update.md`

## Inputs (from invoking prompt)

- **Root** — the open Epic or project-level Story that receives the new work

## Procedure

Every existing Epic and Story description stays as it is.

1. **Read.** `issue tree <rootId>`, then `issue view <id>` on the root and
   on every Story and Task the tree lists. For each of those issues,
   `issue get <id> sourceOutline` prints its stamp; its version is
   `<s>`. `issue outline diff <outlineId> <s> <version>` is the part of the
   outline that issue has not absorbed; run it once per distinct `<s>`. An
   issue stamped at Version already covers its part of the diff.
2. **Place.** For each change in the diff that no issue covers, add the
   work where it belongs in the root:
   - Tasks for an existing open Story: one story-form apply doc per
     receiving Story, run with `issue story append <storyId> <file>`.
   - A new Story: one story-form apply doc that declares only that Story
     and its Tasks, run with `issue apply <file>`.

   Show each command's stdout. Then follow the authoring skill **Tasks with
   no diff (noDiff)** on the created Tasks.
3. **Obsolete work.** For each open issue whose scope the diff removes or
   changes (a Task whose `status` is not `done`, or a Story whose `merged`
   is `false`):
   - **Unstarted** — a Task whose `status` is `todo`, or a Story whose
     `issue story get <id> branchName` prints nothing:
     `issue <kind> set <id> archived true`. When the diff changes that
     scope rather than removing it, place its replacement per step 2.
   - **In progress** — every other such Task or Story:
     `issue <kind> set <id> needsAttention true --reason "<reason>"`, where
     `<reason>` names the outline version and the removed or changed `##`
     section, e.g. `outline v5 removes ## Migration`.
4. **Captures.** When step 2 created a Story, **Read**
   `/root/.cursor/plugins/local/issue-tracker/skills/issue-tracker-plan/references/migrate.md`
   and follow **Promoted mockup artifacts** for this outline, attaching
   only to the Stories step 2 created.
5. **Stamps.** Follow **Decomposer update** in the authoring skill section
   **Source outline (sourceOutline)** with Version.
6. Your final message lists each issue this run created, archived, or
   flagged, one `<created|archived|flagged> <id>` line each, or `none`.
