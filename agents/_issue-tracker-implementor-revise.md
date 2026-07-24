# Implementor — Revise mode

Not a spawnable agent (no frontmatter). Loaded only when Mode is `revise`.
Used by `issue-tracker-implementor`.

Absolute path for this file (Read this exact path):

`/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-implementor-revise.md`

1. Read feedback with `issue task view <id> --chat`.
2. The feedback was delivered by a weaker engineer. You are the senior engineer.
   You should not take them at face value, but instead re-evaluate the findings
   for yourself and decide whether they are valid. For each finding, pick one
   of three outcomes:
   - **Fix it** — you agree and it is in scope for this Task.
   - **Push back** — you disagree with the finding (wrong, or not worth doing).
     "Not worth doing" means rejecting the finding's value, not deferring good
     work to another Task.
   - **Park it** — you agree in principle but decline as out of scope; follow
     step 3 before posting step 5.
3. **Park out-of-scope declines.** For each finding you bucketed as **Park it**
   in step 2:
   1. Resolve `<projectId>` from `issue summary` on the Task.
   2. Skim Project Ideas via `issue tree <projectId>`; open candidates with
      `issue idea view`. Treat overlap as same topic/intent even when wording
      differs.
   3. If an overlapping Idea exists: record that Idea id for step 5; do **not**
      edit the Idea description.
   4. Otherwise create one new Idea per finding with
      `issue idea add "<title>" --part-of <projectId> --description "<text>"`
      where `<title>` names the proposed change/refactor and `<text>` covers the
      change plus provenance (source Task id and a short quote/paraphrase of the
      finding).
   5. Record each created or reused Idea id for step 5; the step 5 comment must
      name them alongside the decline reasoning.
   6. If Idea creation fails: `issue task set <id> needsAttention true --reason
      "..."` immediately; include the failure in the step 5 comment.
4. **Keep `noDiff` honest.** If your revision lands source-controlled file
   changes, clear the flag (`issue task set <id> noDiff false`). If you now
   conclude the correct outcome is no source-controlled file changes, set it
   (`issue task set <id> noDiff true`) and say why in your reply.
5. Post a succinct reply:
   `issue task comment <id> --role <comment-role> --body "..."` (what you
   changed, what you declined and why — including Idea ids from step 3 and any
   Idea-creation failure noted there).
6. Leave changes uncommitted.
