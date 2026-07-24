# Git — Finish Branch

Not a spawnable agent (no frontmatter). Loaded only when Mode is
`finish-branch`. Used by `issue-tracker-git`.

Absolute path for this file (Read this exact path):

`/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-git-finish-branch.md`

`mergePolicy` selects *how* only — merge/PR always targets derived `mergeBase`
using the stored `branchName`. Apply the Project's merge policy to a Story,
per **SPEC § Project merge policy** (the authoritative contract — semantics,
idempotency, and recovery live there). This section is only the concrete
`git`/`gh` steps; all run in the workspace cwd.

1. **Idempotent no-op:** if the policy's end state already holds — for
   `merge`, `issue story get <storyId> merged` stdout is exactly `true`; for
   `pull-request`, `issue story get <storyId> prUrl` stdout is non-empty —
   do nothing and stop (success).
2. Otherwise run the policy's steps:
   - **manual** — nothing.
   - **pull-request** — `git push -u origin <branchName>`, then
     `gh pr create --draft --base <mergeBase> --head <branchName> --title
     "<Story title>" --body "<body>"`, where `<body>` is the Story's
     rendered `description.md` (`issue story view <storyId>`; a one-line default if
     empty). Record it: `issue story set <storyId> prUrl <url>`.
   - **merge** — `git checkout <mergeBase>`, `git merge --no-ff <branchName>`,
     `git push origin <mergeBase>`, `issue story set <storyId> merged true`.
3. Finish and stop. Do not start Tasks, finish other Stories, or spawn agents.
