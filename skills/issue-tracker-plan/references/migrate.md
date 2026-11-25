# Migrate

### Promoted mockup artifacts

Outline decompose attaches mockup captures from this section. From
`/root/.cursor/plugins/local/issue-tracker/app`, run
`npm run outline-mockups -- directions <outlineId>`.

When that prints a direction id, the outline has accepted directions.
Follow **Fresh captures**.

When that prints no direction id, the outline has no accepted directions.
Follow **Chosen PNG archives**.

#### Direction and Story

A capture basename is
`mockup-<directionId>-<stateSlug>-<viewport>.png` (`viewport` is
`phone` or `desktop`). The Story is the one whose surface that
direction mocks: the Story written for the outline section that names
that direction id. The basename belongs to the longest such direction
id for which it starts with `mockup-<directionId>-` and ends with
`-phone.png` or `-desktop.png`.

#### Capture prose

Once per Story, after that Story's captures are attached.

1. Write the tweak wording into that Story's description, as **Chosen
   PNG archives** step 2 does. The outline section that names the
   direction states that wording.

2. In that Story's prose, name each capture attached to that Story.
   Write the paragraph in your own words — not a stock block. It must
   make the **Captures** claims in **Chosen PNG archives**. The **Archive**
   claims are for the archive that section copies onto the Story. The
   live bundle stays on the outline.

#### Fresh captures

1. From `/root/.cursor/plugins/local/issue-tracker/app`, run
   `npm run outline-mockups -- capture <outlineId> --from-pack`.

   The command restores the packed bundles first, which drops a failed
   edit, then prints one absolute PNG path per line. Each basename is
   the one **Direction and Story** names.

2. For each direction id that `directions` printed and the outline
   version names, attach each PNG **Direction and Story** assigns to
   that direction:

   `issue attach <storyId> <pngPath>`

   The Story holds those PNGs. The outline keeps no copy of them.
   Follow **Capture prose** for that Story.

#### Held captures

Reconcile copies captures held on the outline onto the Stories the
published version changes, then removes those PNGs from the outline.
The summary the reconcile procedure ran before the root loop lists each
attachment. A held capture is a listed attachment whose basename is the
one **Direction and Story** names. The path on that summary line is the
PNG path.

For each Story **Direction and Story** assigns to a held capture on
that summary, do the steps below when either holds:

- This pass writes that Story's description.
- This pass appends new Tasks to that Story.

1. For each of that Story's held captures, when the Story already holds
   that basename, `issue detach <storyId> <name>` first. Then:

   `issue attach <storyId> <pngPath>`

   `issue detach <outlineId> <name>`

   The Story holds that PNG. The outline keeps no copy of it.

2. Follow **Capture prose** for that Story.

#### Chosen PNG archives

This promotes the source Idea's chosen PNG archives.

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
   - each both-viewport capture that **Direction and Story** names
   - the archive `mockup-<directionId>.tar.gz`

   Write the paragraph in your own words — not a stock block. It must make
   these claims:

   **Captures**

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

   **Archive**

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
