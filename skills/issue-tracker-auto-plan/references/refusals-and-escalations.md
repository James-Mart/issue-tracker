# Refusals & escalations

Refusal and escalation are **resumable** (Story *"Refusal & escalation are
resumable"* invariant). Recovery differs by kind. Never guess, fall back, or
default a model — surface the gap directly to the human.

- **Preflight gate** — any **## Bootstrap** steps 2–4 refusal, raised before
  the discriminator is spawned. Nothing to resume: report the specific gap to
  the human; they fix the condition and **re-invoke** auto-plan.
- **Post-bootstrap refuse** — either of the **Two refuse conditions** under
  **## Bootstrap**. Report the specific gap to the human and stop. Once the
  human addresses the gap, **resume this same agent** — never a fresh spawn.
  On resume: re-read ALL mandatory sources (source issue + vision +
  inspirationApps) and re-run **both** refuse checks. Proceed only if the gap
  is closed; otherwise refuse again with specifics.
- **Subagent-failure escalation** (a discriminator / planner errored or returned
  an unusable result) — report which subagent failed and how to the human with
  no silent fallback and no model-defaulting. Once the human addresses the
  cause, **resume this same agent**; then re-spawn the failed subagent and
  continue.
- **Other blocked states** — cannot read the source issue / mandatory sources,
  unset `Workspace:` when file work is required, or a finalize `attach` /
  `comment` refusal — same contract: report the block to the human and stop.
  On resume after the human addresses it, continue from the blocked step.
