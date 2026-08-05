---
name: issue-tracker-retro
disable-model-invocation: true
description: >-
  On-demand entry for session confusion retro: delegate issue-tracker-retro on
  a work root. Use when asked for a retro, or load issue-tracker-retro with a
  work root id.
---

# Issue Tracker — Confusion Retro

On-demand entry when a session agent is asked to run retro on a work root.
Callers own spawn timing. Do not expect a confusion summary return value.

Static behavior lives only in
`/root/.cursor/plugins/local/issue-tracker/agents/issue-tracker-retro.md`. Do
not paste or restate that contract here.

## Argument

A **work root** id — Epic or project-level Story — plus its title (from
`issue summary <rootId>` when not supplied). Do not require promoting a Story
to an Epic.

## Delegation

**Read** `/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-delegation.md`.

Delegate `role: issue-tracker-retro` with the work root id and title; wait for
that agent to finish or raise `needsAttention`.

## Spawn stub

Pass as the delegate/`prompt` body (app channel) or Cursor Task `prompt` (IDE
channel). Inline the fields below.

**Retro** — `role: issue-tracker-retro`

> Work root: `<rootId>` (`<title>`).
