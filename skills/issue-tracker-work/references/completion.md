# Completion

The Story walk ends when every Task under the work root is `done`. Give a short
final summary: which Stories were built, and anything still open or escalated
(needsAttention escalation). For validator findings and revise history, point the user
at the tracker comments (`issue view <id> --chat`) rather than collecting them
into your context. Note
how finished Stories landed from the `issue tree` chips (`pr=` for an opened
PR, `merged` for a merged Story, neither when left for the human).

A retro on this session is available on demand through
[issue-tracker-retro](../../issue-tracker-retro/SKILL.md); run one only when
asked.

Everything lives on disk and every derived fact is recomputed on read, so the
loop is **resumable** for unambiguous gates: re-running the skill on the work
root re-reads `issue tree <id>`, continues from the first not-`done` Task,
and the Per-Task **entry gate** branches on `needsAttention` / `qa` (`passed`
→ finalize, `reviewing` → resume code-quality, `changes-requested` → revise
rather than Mode `implement`). Cold-restart windows that disk cannot
disambiguate are listed under that entry gate — do not claim they are fully
handled (or, when all Tasks are already `done`, continue from Completion
above).
