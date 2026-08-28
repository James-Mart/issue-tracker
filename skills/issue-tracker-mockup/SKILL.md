---
name: issue-tracker-mockup
disable-model-invocation: true
description: >-
  Run one mockup round for one UI surface — candidate directions authored as
  Storybook stories, captured, attached to a tracker issue, and the chosen one
  kept. Use when the user asks for a mockup round, UI mockups, or candidate
  design directions for an issue.
---

# Issue Tracker — Mockup round

One run covers **one UI surface** and ends with one chosen direction attached
to the issue given as the argument. Directions are authored as Component Story
Format files in this conversation's gitignored mockup scratch and rendered by a
disposable Storybook against the target project's own components. The target
project's tree is never written — not a source file, not a gitignore entry, not
a manifest change. To cover a second surface, run this skill again.

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
   there is no fallback. Use that one value in every command below and in the
   author's prompt — the author must not read its own.
3. Run every `npm run` command below from
   `/root/.cursor/plugins/local/issue-tracker/app`.

## Round

1. **Author the directions.** Delegate `role: issue-tracker-mockup-author` with
   the author stub, asking for two directions unless the caller asked for a
   different count. Keep the returned nested agent id as `resumeId` for step 4.
   The author starts the stack, renders and revises, and leaves the stack
   running. It returns the direction ids it produced; those ids drive steps 3
   and 5. It also returns any state still not faithful after its own review.
2. **Reuse the harness.**
   `npm run mockup-stack -- start <conversationId>`. Start is idempotent:
   when the author already started the stack, this reuses it. A stopped
   stack is not expected or required. It prints the Storybook base URL.
   The stack refuses to start until the author has written the harness
   configuration, so this step never runs before step 1.
3. **Capture and review.** The author's own captures live in the conversation
   scratch and attach nothing. `mockup-promote` is the only command that puts
   bytes on an issue. Those scratch paths are not candidates the stakeholder
   has been shown.

   For each direction id, in the order the author returned them, run
   `npm run mockup-promote -- --conversation <conversationId> --direction <directionId> --issue <issueId> --mode candidate`.
   Candidate mode captures every state at both widths. It prints stored
   attachment basenames, then one absolute capture path per line, then one
   embed line per PNG of the form
   `![<name>](/api/issues/<issueId>/attachments/<name>)`.
   A repeat round for one direction replaces that direction's earlier
   candidates and keeps the same basenames; other directions stay untouched.

   A state the author reported as not faithful goes back to the author as
   feedback (step 4) rather than being posted. A captured state that still
   renders empty or visibly broken is the same send-back, as a backstop.

   Close the turn with one message that carries both halves. Grouped by
   direction: the direction's name and a one-line description, the embed
   lines that promote printed for every state at both widths, and the live
   Storybook URL (the base URL step 2 printed). After those groups, every
   absolute capture path from every direction in this round. The embed lines
   are the human half and the paths are the agent half; both ship in that
   single message, and neither substitutes for the other.
4. **Feedback.** Re-enter the same author agent with the feedback stub and its
   `resumeId` — when it is lost, look it up with `delegations`, taking the most
   recent entry whose role is `issue-tracker-mockup-author`. Then repeat step 3.
   The harness stays up across feedback rounds.
5. **Selection.** With the stakeholder's `<chosenDirectionId>`, run in order:
   - `npm run mockup-promote -- --conversation <conversationId> --direction <chosenDirectionId> --issue <issueId> --mode chosen`
     — captures every state at both widths, attaches those PNGs plus the
     archive, replaces that direction's earlier chosen attachments (PNGs and
     archive) and keeps the same basenames, and detaches every candidate
     attachment from the issue. Other directions' chosen files stay untouched.
     It prints the same three blocks as candidate mode.
   - `npm run mockup-prune -- --conversation <conversationId> --keep <chosenDirectionId>`
   - `npm run mockup-stack -- stop <conversationId>`

   Close with one message that carries that run's printed embed lines and
   every absolute capture path, and stop. The round is over.

## Spawn stubs

Pass each stub's delegate arguments (`role`, `issueId`, `prompt`; plus
`resumeId` when resuming) and inline the fields it lists. Channel rules:
**## Delegation** (do not re-Read the include here).

**Author** — `role: issue-tracker-mockup-author`, `issueId: <issueId>`
(when to delegate: Round step 1)

> Issue: `<issueId>`. Surface: `<surface>`. Target workspace: `<workspace>`.
> Conversation id: `<conversationId>`. Direction count: `<count>`.

**Author (feedback)** — `role: issue-tracker-mockup-author`,
`issueId: <issueId>` (when to resume: Round step 4)

> Feedback: `<stakeholder feedback>`. Revise the directions it names and leave
> the others as they are.
