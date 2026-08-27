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
   The author returns the direction ids it produced; those ids drive steps 3
   and 5.
2. **Start the harness.**
   `npm run mockup-stack -- start <conversationId>`. It prints the Storybook
   base URL — hand that URL to the stakeholder, who can open the live
   directions in a browser. The stack refuses to start until the author has
   written the harness configuration, so this step never runs before step 1.
3. **Capture and post.** For each direction id, in the order the author
   returned them:
   - `npm run mockup-promote -- --conversation <conversationId> --direction <directionId> --issue <issueId> --mode candidate`
     — it prints that direction's stored attachment basenames, then one
     absolute capture path per line.
   - Post one message naming that direction and embedding each basename that
     run printed as `![<name>](/api/issues/<issueId>/attachments/<name>)`. Use
     the printed basenames: a repeat round stores a fresh basename rather than
     overwriting the earlier one.

   Then end your turn with a reply listing every absolute capture path from
   every direction in this round. The embedded images are what a human
   stakeholder reviews and the paths are what an agent stakeholder opens;
   produce both, every round.
4. **Feedback.** Re-enter the same author agent with the feedback stub and its
   `resumeId` — when it is lost, look it up with `delegations`, taking the most
   recent entry whose role is `issue-tracker-mockup-author`. Then repeat step 3.
   The harness stays up across feedback rounds.
5. **Selection.** With the stakeholder's `<chosenDirectionId>`, run in order:
   - `npm run mockup-promote -- --conversation <conversationId> --direction <chosenDirectionId> --issue <issueId> --mode chosen`
     — attaches that direction's phone and desktop PNGs plus its archive, and
     detaches every candidate attachment from the issue.
   - `npm run mockup-prune -- --conversation <conversationId> --keep <chosenDirectionId>`
   - `npm run mockup-stack -- stop <conversationId>`

   Report the chosen direction's attached basenames and absolute capture paths,
   and stop. The round is over.

## Spawn stubs

Pass each stub's delegate arguments (`role`, `issueId`, `prompt`; plus
`resumeId` when resuming) and inline the fields it lists. Channel rules:
**## Delegation** (do not re-Read the include here).

**Author** — `role: issue-tracker-mockup-author`, `issueId: <issueId>`
(when to delegate: Round step 1)

> Surface: `<surface>`. Target workspace: `<workspace>`. Conversation id:
> `<conversationId>`. Direction count: `<count>`.

**Author (feedback)** — `role: issue-tracker-mockup-author`,
`issueId: <issueId>` (when to resume: Round step 4)

> Feedback: `<stakeholder feedback>`. Revise the directions it names and leave
> the others as they are.
