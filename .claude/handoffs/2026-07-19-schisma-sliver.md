# Schisma sliver: first plate-as-interface build — 2026-07-19

Arc: Derek asked for design-free concept prompts → cited versions → ideal-design
briefs → a Sonnet pass per station under the constraint "stay as close to the
original image as possible" (all ten v2 briefs: #3160 comment 2026-07-19) → pilot
build of Station II's brief, shipped same session (PR #3223, deployed).

## Shipped
`SchismaSliverDemo` (`src/components/blog/lab/SchismaSliverDemo.tsx`): Descartes'
Compendium p31 pie as the live canvas. Drag the printed Schisma sliver (or the
accessible slider) to equal-temper his scale; rust boundary lines drift from the
engraved radials by true cents; "Play his scale" loops the pie's notes at the
current morph. p31 removed from the CommaSpiralDemo folio strip (graduated);
connecting prose added. Verified on preview at t=0/0.55/1.0 (screenshots on the PR).

## The registration method that worked (reusable for the other nine briefs)
1. The plate is hand-drawn: wedge apex (348,315 in the 645×1298 crop) is NOT the
   rim's center, and no global rotation fits all radials.
2. Measure each printed line's angle individually: Python/PIL renders computed
   overlay lines on the crop → eyeball against ink → adjust → 3 iterations.
3. Apply interaction drift FROM the measured angles (0.3°/cent), so overlay==ink
   at rest by construction. Only render overlays when state ≠ rest.
4. Serve the scan inside the SVG (`<image>` + viewBox windowing) so image and
   overlay share one coordinate system — no CSS registration math.

## The plate paid for the close reading (pattern now 3-for-3)
486:480 = 81:80 — Descartes drew two sizes of D and the sliver is their
disagreement (SYNTONIC comma 21.5¢, cousin of the Pythagorean 23.5¢ — copy keeps
them distinct). Equal-tempering merges the two D's: the sliver closes because the
disagreement resolves. None of this was in the design until the string numbers
forced it.

## Open
- Nine remaining v2 briefs on #3160 (next best: Kircher pendulums, Station VI —
  five bobs to register, arcs are pre-labeled coincidence indicators).
- Still no human listen-test of smithy ensemble / planet choir / sliver scale.
- Parallel session filed #3224 (playable facsimiles as a site feature —
  PlayableDiagram + per-page registry); the sliver demo is prior art for it.

## CLAUDE.md check
No new repo invariant; the registration method is recorded here and in
project_sound_laboratory.md (auto-memory). Conventions unchanged.
