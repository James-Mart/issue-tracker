# Completion

The Story walk ends when every Task under the work root is `done`, or when
every Story left to work is parked or nested under a parked Story (see
**Park a Story** in the skill). Give a short final summary: which Stories were
built, each Story parked awaiting a human, and anything still open or
escalated (needsAttention escalation). For validator findings and revise
history, point the user at the tracker comments (`issue view <id> --comments`)
rather than collecting them into your context. Note
how finished Stories landed from the `issue tree` chips (`pr=` for an opened
PR, `merged` for a merged Story, neither when left for the human).

A retro on this session is available on demand through
[issue-tracker-retro](../../issue-tracker-retro/SKILL.md); run one only when
asked.

Everything lives on disk and every derived fact is recomputed on read, so the
loop is **resumable** for unambiguous gates: re-running the skill on the work
root re-reads `issue tree <id>`, continues from the first not-`done` Task,
and the Per-Task **entry gate** branches on `needsAttention` / `qa` (`passed`
→ advance, `reviewing` → resume code-quality, `changes-requested` → revise
rather than Mode `implement`). A parked Story resumes the same way: once the
human's Done clears `review`, a re-run reaches its Close a Story, which runs
Story review again. Cold-restart windows that disk cannot
disambiguate are listed under that entry gate — do not claim they are fully
handled (or, when all Tasks are already `done`, continue from Completion
above).
