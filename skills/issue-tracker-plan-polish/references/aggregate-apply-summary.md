# Aggregate → apply → summary

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
     (conciseness, formatting, then auto-apply when the draft differs) —
     escalate is not a terminal stop.
   - Clear error/warning fixes apply without asking.
3. **Compose and retain** one full-state apply YAML from the deduplicated
   findings and your invented fixes, matching the work-root kind, per
   issue-tracker-authoring and
   [SPEC.md § apply doc format](../../../SPEC.md#apply-doc-format). Keep this
   YAML internal — do not paste it into chat. Every issue in the doc carries
   its full `description`, including issues the checks did not change.
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
     must still appear in the step-8 summary.
4. **Conciseness.** For each description in the draft, delegate
   `issue-tracker-plan-concise` with the stub below. **Read**
   `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-delegation.md`
   before the first of these delegations. Keep at most six of them in flight;
   start the next description when one returns. Pass that issue's id, its
   draft description, its parent title (the Project title when the parent is
   the Project), and the titles of the other issues with the same parent.
   Parse each reply per
   [`agents/issue-tracker-plan-concise.md`](../../../agents/issue-tracker-plan-concise.md).
   Accept a suggestion that meets that file's **What you change** and whose
   `issueId` is the issue you sent — write that markdown into the issue's
   `description` in the draft. Any other reply leaves that description
   unchanged. After every suggestion is decided, continue at step 5.

   **Conciseness** — `role: issue-tracker-plan-concise`

   > Issue: `<issueId>`. Draft description: `<markdown>`. Parent: `<parentTitle>`. Siblings: `<sibling titles>`.
   >
   > Return only JSON per `agents/issue-tracker-plan-concise.md` (per that file's **What you change**; every detail kept; no prose wrapper).

5. **Formatting.** For each description in the draft, delegate
   `issue-tracker-plan-format` with the stub below. Keep at most six of them
   in flight; start the next description when one returns. Pass that issue's
   id, its draft description, its parent title (the Project title when the
   parent is the Project), and the titles of the other issues with the same
   parent. Parse each reply per
   [`agents/issue-tracker-plan-format.md`](../../../agents/issue-tracker-plan-format.md).
   Accept a suggestion that meets that file's **What you change** and whose
   `issueId` is the issue you sent — write that markdown into the issue's
   `description` in the draft. Any other reply leaves that description
   unchanged. After every suggestion is decided, continue at step 6.

   **Formatting** — `role: issue-tracker-plan-format`

   > Issue: `<issueId>`. Draft description: `<markdown>`. Parent: `<parentTitle>`. Siblings: `<sibling titles>`.
   >
   > Return only JSON per `agents/issue-tracker-plan-format.md` (clean rendering; every word and detail kept; no prose wrapper).

6. **Auto-apply when safe.** When step 2 did not escalate and the draft
   differs from the live tree (check fixes or accepted conciseness or
   formatting suggestions): write it to a temp file (or stdin) and run the
   matching CLI so tracker writes stay **single-threaded** through this
   coordinator. Do **not** ask yes/no to apply. When the draft matches the
   live tree, leave the tracker as it is and continue at step 8.
   - **Append-target Story** — when `<rootKind>` = `story` and
     `issue list task --in <rootId>` includes a Task with `appended` true:
     `issue story append <rootId> <file>`.
   - **Otherwise** (Epic or non-append Story): `issue apply <file>`.
   Write path is the retained apply doc per issue-tracker-authoring
   (declarative apply) — epic-form or story-form per Bootstrap `<rootKind>`.
7. **Re-check.** Enter this step only when the preceding step 6
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
     findings array, continue to step 8. When findings remain and an
     escalate is unresolved, do not exit here — escalate (step 2) stays
     mandatory for unsafe auto-apply; resolve it, then continue. When
     findings remain and there is **no** unresolved escalate, the
     planner may unilaterally **veto continued polish** and proceed to
     step 8, or continue from step 2 through step 6. Veto grounds are
     planner judgment only (diminishing returns, checker conflict, good
     enough) — no iteration cap, no per-finding veto API, no
     checker-precedence rules. Repeat this step from **Re-enter flagging
     agents** only when that step 6 applied a retained YAML; otherwise
     continue to step 8 (remaining findings, including warnings retained
     per step 3, appear in the summary).
8. **Post-apply summary.** After step 7 finishes or was not entered, show
   in chat a **short informational** summary. Include **every
   non-escalated finding** (with severities) — including warnings whose
   fixes were not adopted — plus the plan changes applied when apply ran
   (check fixes and accepted conciseness or formatting suggestions).
   When exit was a planner **veto** of continued polish, state explicitly
   that continued polish was **vetoed**, give a short reason, **and**
   list the leftover findings (with severities) so callers can distinguish
   veto from “nothing left to apply” / warnings-retained exits. State
   explicitly that **no changes are needed** only when there are
   **zero findings** (truly clean) and no accepted conciseness or
   formatting suggestion. Do **not** dump the apply YAML into chat. Show
   stdout from the step-6 command (created/updated + subtree outline;
   `issue apply` may also report deleted) when auto-apply ran.
9. **Archive source Idea.** When this run completes successfully (no
   unresolved escalate from step 2), follow **## Archive source Idea** in
   `/root/.cursor/plugins/local/issue-tracker/skills/issue-tracker-plan-polish/SKILL.md`.
