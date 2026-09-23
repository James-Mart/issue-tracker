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
`git`/`gh` steps.

Push, `git log`, and `gh pr create` run with the `Workspace:` path from
`issue summary <storyId>` as cwd. After start-branch that path is the
Story worktree. Merge and fast-forward run in the Project workspace
(`issue project get <projectId> workspace`), the checkout that stays on
trunk.

1. **Idempotent end state:** if the policy's end state already holds:
   - **pull-request** — `issue story get <storyId> prUrl` stdout is
     non-empty: stop (success).
   - **merge** / **fast-forward** — `issue story get <storyId> merged`
     stdout is exactly `true`: stop (success). Do not re-merge or re-push
     the base.
2. Otherwise push the Story branch first, then apply the policy:
   - `git push -u origin <branchName>`. On failure, **Read**
     `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-git-escalation.md`
     and follow it (Story `needsAttention`) — stop.
   - Then:
     - **manual** — stop (success).
     - **pull-request** — `gh pr create --draft --base <mergeBase> --head
       <branchName> --title "<Story title>" --body "<body>"`. Load intent
       from the Story title and `issue story view <storyId>`. Load commit
       subjects with `git log --format=%s <mergeBase>..<branchName>`.
       Write `<body>` as one or two sentences of bare prose that say
       what the change is and why it is needed. Write new sentences
       from that intent and those subjects. If the description is empty
       and the subjects do not help, one sentence from the title is
       enough.
       Record it: `issue story set <storyId> prUrl <url>`.
     - **merge** — in the Project workspace: `git merge --no-ff
       <branchName>`, `git push origin <mergeBase>`. Then
       `issue story set <storyId> merged true`.
     - **fast-forward** — in the Project workspace: `git merge --ff-only
       <branchName>`. On failure (base advanced; fast-forward not
       possible), leave the base untouched and
       `issue story set <storyId> needsAttention true --reason "base
       <mergeBase> advanced; fast-forward not possible, rebase needed"`, then
       stop. On success, `git push origin <mergeBase>`. Then
       `issue story set <storyId> merged true`.
3. Finish and stop. Do not start Tasks, finish other Stories, or spawn agents.
