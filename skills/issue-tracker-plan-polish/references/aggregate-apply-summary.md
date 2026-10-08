# Aggregate → apply → summary

**Apply the retained draft** is the tracker write both apply steps use.
Write the draft to a temp file (or stdin) and run the matching CLI so
tracker writes stay **single-threaded** through this coordinator. Do
**not** ask yes/no to apply.

- **Append-target Story** — when `<rootKind>` = `story` and
  `issue list task --in <rootId>` includes a Task with `appended` true:
  `issue story append <rootId> <file>`.
- **Otherwise** (Epic or non-append Story): `issue apply <file>`.

Write path is the retained apply doc per issue-tracker-authoring
(declarative apply) — epic-form or story-form per Bootstrap `<rootKind>`.

After all five return:

1. Parse each result as a JSON findings array per
   [`agents/_issue-tracker-plan-polish-check-base.md`](../../../agents/_issue-tracker-plan-polish-check-base.md).
   Deduplicate overlapping findings.
2. **Severity / remediation:** For every finding, invent concrete remediation
   from `problem` text plus tree context (`issue tree`, `<kind> view`). Fold
   clear fixes for every `error` and clear `warning` remediations into the
   retained apply plan. Any unresolved `error` means you **must not** treat
   the outcome as “no changes needed”.
   - **Escalate (do not apply)** when auto-apply is unsafe: conflicting errors
     or ambiguous fixes. Stop and ask the user how to resolve; do not guess.
     After the user resolves the escalate, incorporate their resolution,
     re-compose the retained plan if needed, then continue at step 4
     (auto-apply of check fixes when the draft differs). Escalate is not a
     terminal stop.
   - Clear error/warning fixes apply without asking.
3. **Compose and retain** one full-state apply YAML from the deduplicated
   findings and your invented fixes, matching the work-root kind, per
   issue-tracker-authoring and
   [SPEC.md § apply doc format](../../../SPEC.md#apply-doc-format). Keep this
   YAML internal — do not paste it into chat. Every issue in the doc carries
   its full `description`, including issues the checks did not change.
   The loop composes and applies only these check fixes.
   - **Epic** (`<rootKind>` = `epic`) — epic-form: `project: <projectId>`
     string + `epic:` object.
   - **Story** (`<rootKind>` = `story`) — story-form:
     `project: <projectId>` string + `story:` object. When
     `issue story get <rootId> partOf` is an Epic id, include
     `epic: <epicId>` as that existing-epic reference. When `partOf` is
     `<projectId>`, omit the `epic:` key. When the work root is an
     append-target Story, the changes in that YAML are the Tasks whose
     `appended` flag is set.
   - When there are **zero** `error` findings and you are not adopting
     warning fixes, the draft is that same full-state doc of the work root
     as it stands (append-target: the appended Tasks). Warnings that remain
     must still appear in the summary.
4. **Auto-apply check fixes when safe.** When step 2 did not escalate and the
   draft differs from the live tree, apply the retained draft. When the
   draft matches the live tree, leave the tracker as it is and continue at
   step 6.
5. **Re-check.** Enter this step only when the preceding step 4
   successfully applied a retained YAML. Then:
   - **Re-enter flagging agents.** **Read**
     `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-delegation.md`
     and re-enter each check agent that returned one or more findings in
     the round whose fixes were just applied — the same nested instances
     (`resumeId` on the app channel; Cursor Task `resume` on the IDE
     channel). Do not re-enter agents that returned an empty array; do
     not delegate a second instance of any check agent. Prompt each
     re-entered agent to revalidate its prior concerns against the
     updated tree and return only a JSON findings array per
     [`agents/_issue-tracker-plan-polish-check-base.md`](../../../agents/_issue-tracker-plan-polish-check-base.md).
   - **Re-check.** When those re-entered agents return, parse their JSON
     findings arrays (same schema as step 1). Deduplicate overlapping
     findings among them.
   - **Exit or continue.** When every re-entered agent returned an empty
     findings array, continue to step 6. When findings remain and an
     escalate is unresolved, do not exit here — escalate (step 2) stays
     mandatory for unsafe auto-apply; resolve it, then continue. When
     findings remain and there is **no** unresolved escalate, the
     planner may unilaterally **veto continued polish** and proceed to
     step 6, or continue from step 2 through step 4. Veto grounds are
     planner judgment only (diminishing returns, checker conflict, good
     enough) — no iteration cap, no per-finding veto API, no
     checker-precedence rules. Repeat this step from **Re-enter flagging
     agents** only when that step 4 applied a retained YAML; otherwise
     continue to step 6 (remaining findings, including warnings retained
     per step 3, appear in the summary).
6. **Copyedit.** Enter this step once when step 4 or step 5 continues
   here. For each description
   in the draft, delegate `issue-tracker-plan-copyedit` with the stub
   below. **Read**
   `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-delegation.md`
   before the first of these delegations. Keep at most six of them in
   flight; start the next description when one returns. Pass that issue's
   id, its draft description, its parent title (the Project title when the
   parent is the Project), and the titles of the other issues with the
   same parent. Parse each reply per
   [`agents/issue-tracker-plan-copyedit.md`](../../../agents/issue-tracker-plan-copyedit.md).
   Accept a suggestion that meets that file's **What you change** and whose
   `issueId` is the issue you sent — write that markdown into the issue's
   `description` in the draft. Any other reply leaves that description
   unchanged. After every suggestion is decided, when an accepted
   suggestion changed the draft, apply the retained draft. When no
   suggestion was accepted, leave the tracker as it is. Do not re-enter a
   check agent after this step.

   **Copyedit** — `role: issue-tracker-plan-copyedit`

   > Issue: `<issueId>`. Draft description: `<markdown>`. Parent: `<parentTitle>`. Siblings: `<sibling titles>`.
   >
   > Return only JSON per `agents/issue-tracker-plan-copyedit.md` (per that file's **What you change**; every fact, name, constraint, and condition kept; no prose wrapper).

7. **Post-apply summary.** After step 6 finishes, show in chat a **short
   informational** summary. Include **every non-escalated finding** (with
   severities) — including warnings whose fixes were not adopted — plus
   the plan changes applied when apply ran (check fixes and accepted
   copyedit suggestions). When exit was a planner **veto** of continued
   polish, state explicitly that continued polish was **vetoed**, give a
   short reason, **and** list the leftover findings (with severities) so
   callers can distinguish veto from “nothing left to apply” /
   warnings-retained exits. State explicitly that **no changes are
   needed** only when there are **zero findings** (truly clean) and no
   accepted copyedit suggestion. Do **not** dump the apply YAML into
   chat. Show stdout from each apply command that ran (created/updated +
   subtree outline; `issue apply` may also report deleted).
8. **Archive source Idea.** When this run completes successfully (no
   unresolved escalate from step 2), follow **## Archive source Idea** in
   `/root/.cursor/plugins/local/issue-tracker/skills/issue-tracker-plan-polish/SKILL.md`.
