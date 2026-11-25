---
name: issue-tracker-mockup
disable-model-invocation: true
description: >-
  Run one mockup round for one UI surface. The first draft goes through
  design-conformance; a later redirection resumes the mockup author.
---

# Issue Tracker — Mockup round

One run covers **one UI surface** and ends with one chosen direction attached
to the issue given as the argument. The first draft runs through the
design-conformance agent, which spawns the mockup author and reviews the
captures. A later redirection resumes that same mockup author with the
redirection as its feedback and leaves design-conformance idle. This skill
coordinates the caller's three beats — ask for a round, post what comes back,
relay feedback or acceptance. The target project's tree is never written —
not a source file, not a gitignore entry, not a manifest change. To cover a
second surface, run this skill again.

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
2. Call `delegations` per **## Delegation** and set `<conversationId>` to
   `root.agentId`. When `root` is omitted → stop and hand back to the user.
   Use that one value in every conformance stub.

## Round

1. **Conformance.** Delegate `role: issue-tracker-design-conformance` with the
   Conformance stub, asking for one direction unless the caller asked for a
   different count. Keep the returned nested agent id as the conformance
   `resumeId`. That agent spawns the mockup author and reviews the captures.
   This is the first draft.
2. **Post the return.** Close with one message that carries the whole return
   from the agent that just finished. Post every absolute capture path and
   every embed line and `[Open live Storybook](...)` link that return
   includes. A path does not stand in for a link, and a link does not stand
   in for a path. When the return includes an escalation, post it whole the
   same way.
3. **Wait.** The round stops here until the caller decides. Who answers and
   with what options belongs to the caller.
4. **Feedback.** When the caller brings back a redirection, resume the same
   mockup author with the Author (feedback) stub, putting that redirection
   in `<feedback>`. Leave the design-conformance agent idle. The author's
   `resumeId`
   is the most recent `delegations` entry whose role is
   `issue-tracker-mockup-author`. Then repeat step 2.
5. **Acceptance.** With the caller's `<chosenDirectionId>`, re-enter the same
   conformance agent with the Conformance (acceptance) stub and the
   conformance `resumeId`. When that id is lost, look it up with
   `delegations`, taking the most recent entry whose role is
   `issue-tracker-design-conformance`. Then repeat step 2 and stop. The round
   is over.

## Spawn stubs

Pass each stub's delegate arguments (`role`, `issueId`, `prompt`; plus
`resumeId` when resuming) and inline the fields it lists. Channel rules:
**## Delegation** (do not re-Read the include here).

**Conformance** — `role: issue-tracker-design-conformance`, `issueId: <issueId>`
(when to delegate: Round step 1)

> Issue: `<issueId>`. Surface: `<surface>`. Target workspace: `<workspace>`.
> Conversation id: `<conversationId>`. Direction count: `<count>`.

**Author (feedback)** — `role: issue-tracker-mockup-author`,
`issueId: <issueId>` (when to resume: Round step 4)

> Feedback: `<feedback>`.

**Conformance (acceptance)** — `role: issue-tracker-design-conformance`,
`issueId: <issueId>` (when to resume: Round step 5)

> Chosen direction id: `<chosenDirectionId>`.
