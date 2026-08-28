---
name: issue-tracker-mockup
disable-model-invocation: true
description: >-
  Run one mockup round for one UI surface — delegates to the design-conformance
  agent, which authors one conformant direction by default, captures it, and
  attaches it to a tracker issue. Use when the user asks for a mockup round,
  UI mockups, or a design direction for an issue.
---

# Issue Tracker — Mockup round

One run covers **one UI surface** and ends with one chosen direction attached
to the issue given as the argument. The design-conformance agent owns authoring,
harness, capture, and conformance review; this skill coordinates the caller's
three beats — ask for a round, post what comes back, relay feedback or
acceptance. The target project's tree is never written — not a source file, not
a gitignore entry, not a manifest change. To cover a second surface, run this
skill again.

**Read** `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-cli.md`.

**Read** `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-ikigai.md`.

## Delegation

**Read** `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-delegation.md`.

## Argument

An **issue id** — the issue that receives this round's captures and, on
selection, the chosen direction's archive.

The **surface** to mock up comes from the caller's request. When the caller
named no surface, ask for it before step 1.

## Bootstrap

1. Run `issue summary <issueId>`, then **Read**
   `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-workspace-gate.md`
   and apply it to that output. The Project `Workspace:` it gates is this
   round's **target workspace**.
2. `<conversationId>` is the value of `$CURSOR_CONVERSATION_ID`. Empty → stop
   and hand back to the user: the scratch and the harness are keyed by it and
   there is no fallback. Use that one value in every conformance stub — the
   conformance agent must not read its own.

## Round

1. **Conformance.** Delegate `role: issue-tracker-design-conformance` with the
   Conformance stub, asking for one direction unless the caller asked for a
   different count. Keep the returned nested agent id as `resumeId`.
2. **Post the return.** Close with one message that carries both halves of
   what the conformance agent returned. The embed lines and the live Storybook
   base URL are the human half; every absolute capture path is the agent half.
   Both ship in that single message, and neither substitutes for the other.
   When the return includes an escalation, post it whole the same way.
3. **Wait.** The round stops here until the caller decides. Do not resume the
   conformance agent on your own initiative — who answers and with what options
   belongs to the caller.
4. **Feedback.** When the caller brings back a redirection, re-enter the same
   conformance agent with the Conformance (feedback) stub and its `resumeId` —
   when it is lost, look it up with `delegations`, taking the most recent
   entry whose role is `issue-tracker-design-conformance`. Then repeat step 2.
5. **Acceptance.** With the caller's `<chosenDirectionId>`, re-enter the same
   conformance agent with the Conformance (acceptance) stub and its `resumeId`
   (same lookup when lost). Then repeat step 2 and stop. The round is over.

## Spawn stubs

Pass each stub's delegate arguments (`role`, `issueId`, `prompt`; plus
`resumeId` when resuming) and inline the fields it lists. Channel rules:
**## Delegation** (do not re-Read the include here).

**Conformance** — `role: issue-tracker-design-conformance`, `issueId: <issueId>`
(when to delegate: Round step 1)

> Issue: `<issueId>`. Surface: `<surface>`. Target workspace: `<workspace>`.
> Conversation id: `<conversationId>`. Direction count: `<count>`.

**Conformance (feedback)** — `role: issue-tracker-design-conformance`,
`issueId: <issueId>` (when to resume: Round step 4)

> Redirection: `<caller redirection>`.

**Conformance (acceptance)** — `role: issue-tracker-design-conformance`,
`issueId: <issueId>` (when to resume: Round step 5)

> Chosen direction id: `<chosenDirectionId>`.
