# Git — Finish Branch

Not a spawnable agent (no frontmatter). Loaded only when Mode is
`finish-branch`. Used by `issue-tracker-git`.

Absolute path for this file (Read this exact path):

`/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-git-finish-branch.md`

`mergePolicy` selects *how* only — merge/PR always targets derived `mergeBase`
using the stored `branchName`. Apply the Story's effective merge policy
(`issue story get <storyId> mergePolicy`), per **SPEC § Project merge policy**
(the authoritative contract — semantics,
idempotency, and recovery live there). This section is only the concrete
`git`/`gh` steps; all run in the workspace cwd.

1. **Idempotent end state:** if the policy's end state already holds:
   - **pull-request** — `issue story get <storyId> prUrl` stdout is
     non-empty: stop (success).
   - **merge** / **fast-forward** — `issue story get <storyId> merged`
     stdout is exactly `true`: run step 3 with `Bp` = `issue story get
     <storyId> mergeBase`, then stop (success). Do not re-merge or re-push
     the base.
2. Otherwise push the Story branch first, then apply the policy:
   - `git push -u origin <branchName>`. On failure, **Read**
     `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-git-escalation.md`
     and follow it (Story `needsAttention`) — stop.
   - Then:
     - **manual** — stop (success).
     - **pull-request** — `gh pr create --draft --base <mergeBase> --head
       <branchName> --title "<Story title>" --body "<body>"`, where `<body>`
       is the Story's rendered `description.md` (`issue story view <storyId>`;
       a one-line default if empty). Record it:
       `issue story set <storyId> prUrl <url>`.
     - **merge** — `git checkout <mergeBase>`, `git merge --no-ff <branchName>`,
       `git push origin <mergeBase>`, `issue story set <storyId> merged true`.
       Then run step 3 with `Bp` = that `<mergeBase>`.
     - **fast-forward** — `git checkout <mergeBase>`, `git merge --ff-only
       <branchName>`. On failure (base advanced; fast-forward not possible),
       leave the base untouched and
       `issue story set <storyId> needsAttention true --reason "base
       <mergeBase> advanced; fast-forward not possible, rebase needed"`, then
       stop. On success, `git push origin <mergeBase>`, `issue story set
       <storyId> merged true`. Then run step 3 with `Bp` = that `<mergeBase>`.
3. **Flag stale children** (`merge` / `fast-forward` only):
   1. Take `<projectId>` from the `Project: <projectId> — <title>` line of
      `issue summary <storyId>`.
   2. Run `issue list story --in <projectId>` once. For each entry in
      `issues[]`, read `merged` and `branchName` from the entry and
      `storyStatus` and `mergeBase` from `derived[<id>]`.
   Find every not-yet-merged Story other than `<storyId>` whose derived
   `storyStatus` is not `not-started` (skip when `branchName` is empty) and
   whose derived `mergeBase` is `Bp`, and run `issue story set <childId>
   needsRebase <Bp>` for each. Do not rebase any of them.
4. Finish and stop. Do not start Tasks, finish other Stories, or spawn agents.
