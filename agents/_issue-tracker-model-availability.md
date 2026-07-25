# Model availability

Not a spawnable agent (no frontmatter). Cross-cutting skill-facing rule
for every Cursor Task spawn that names a model pin. Callers **Read** this
file from disk — a markdown link alone is not enough.

Absolute path for this file (Read this exact path):

`/root/.cursor/plugins/local/issue-tracker/agents/_issue-tracker-model-availability.md`

Each named model is the pin its target agent carries. Pass it as Cursor
Task `model` when that slug is among those your Task tool advertises; when
it is not, pass no model at all — the pin travels with the agent definition
and the host applies it. Never substitute a different slug, and do not
treat an unavailable slug as a refusal (or as grounds for `needsAttention`).
