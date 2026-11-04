# Migrate

### Promoted mockup artifacts

When the grill included mockup rounds with chosen directions, after the
plan lands work on a Story implementing a mocked surface, for each chosen
direction on that surface:

1. From `/root/.cursor/plugins/local/issue-tracker/app`, run
   `npm run mockup-promote -- --from-issue <fromIssueId> --direction <directionId> --issue <storyId> --mode copy`
   where:
   - `<fromIssueId>` — the source Idea this migration is from, where the round
     already attached the chosen direction
   - `<directionId>` — the direction the stakeholder chose for that surface,
     carried forward from the grill the same way the merge-base is (one round
     covers one surface, so there is exactly one chosen direction per surface)
   - `<storyId>` — the resulting Story that implements that surface

   Copy mode moves bytes already attached — the round's scratch and harness are
   gone by migrate time, so nothing is re-rendered. Imperative only — not in
   the YAML doc. `apply` never writes attachment bytes.

2. Write the tweak wording held with that direction (**Held tweak wording**
   in the parent skill) into that Story's description.

3. In that Story's prose, name the copied files and state what they are so an
   implementor meets them where the work is. The files are those defined in
   `promote-direction-artifacts`:
   - each both-viewport capture
     `mockup-<directionId>-<stateSlug>-<viewport>.png`
   - the archive `mockup-<directionId>.tar.gz`

   Write the paragraph in your own words — not a stock block. It must make
   these claims:
   - The named screenshots record the direction chosen for the surface: its
     content and hierarchy, the states it must support, where affordances live,
     and how interactions behave. An implementor honors those decisions while
     owning the execution.
   - Where the Story's prose and the attached mockup disagree, the prose wins
     on the point it names. The mockup stays the direction for everything the
     prose does not change.
   - Where a mockup diverges from the `designSystem` supporting doc, existing
     repo conventions, or the app's real components, those still win. Better
     spacing, copy, or polish is expected rather than deviation.
   - No gate compares an implementation against the captures.
   - The named archive is reference material. Read it for composition, layout,
     class structure, and the enumeration of states the surface has to support.
     Lift from it deliberately.
   - Its prop shapes were invented to make a picture render, not derived from
     real types, and where no real component existed the direction was
     deliberately lower fidelity. Wiring a mockup to real state is the work, not
     a formality.
   - Its source is allowed to rot as the target project moves underneath it.
     Nobody should be surprised when it no longer builds.
   - There is no restore path. Re-rendering an archived direction in a live
     harness is not a supported move, and the archive must not be described
     as though it were.

Surfaces whose round ended with no chosen direction — a dropped escalation —
skip this step.
