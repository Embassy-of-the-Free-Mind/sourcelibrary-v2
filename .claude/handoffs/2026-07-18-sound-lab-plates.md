# Sound Laboratory: plates + engraving-driven interactive upgrades — 2026-07-18

Session arc: "deep dive on images for /blog/sound-laboratory" → verified plate survey
→ "how does this inspire the interactives?" → full build, PR #3189, deployed to prod.

## Shipped (merged #3189, deployed, purge+warm verified, issue #3183 closed)

- **`FolioFigure`/`FolioPair`** (`src/components/blog/lab/FolioFigure.tsx`) — shared
  captioned-plate chrome; every plate links its reader page (`?page=N` form only).
- **A verified plate on every station** (8 from the cited book itself). Off-source
  plates (Day 1891, Strangways, Doré, Mundus Subterraneus) say so in their captions.
- **Interactive upgrades specified by the engravings** — the design thesis was: let
  each demo render its state in its source's own graphical language.
  - I: Gaffurius woodcut embedded; hammers IIII/VI/VIII/XII/XVI are tap-targets that
    hang that ratio; whole-smithy ensemble (legend-law concord vs √tension smear).
  - II: comma drawn as a filled wedge (Descartes' schisma idiom); recovered p31 pie
    added to folio strip; Zhu staircase revealed in equal-temperament mode.
  - V: ghost gets note names + implied-bass line; Tartini p177 plate with playable
    figure presets.
  - VI: canvas pulse-dot coincidence viz; dots pack into a band at the rate the ear
    stops counting; honors prefers-reduced-motion.
  - VII: Kepler p336 engraving is the planet selector (percent-region hotspots);
    schematic staff (his noteheads vs measured sky) with SMIL sweep dot; six-planet
    choir mode.
  - VIII: **content fix** — pluck now has partials (1/h) and the untouched string
    modes (1/√m), so the fifth answers via the shared 660 Hz partial. The old
    pure-sine model silently falsified Kircher's "necessario quintam sonabit."
  - X: results screen only — Euler p66 plate + reader's dyads as Euler-style dot
    rows. Showing dot figures before rating would unblind the trial (ratio
    simplicity is legible by eye).

## Data work

- Targeted `reextract-missed-pages.mjs --any-marker --book=<id>` mini-sweep on the
  four stranded source books (Derek approved the ~$0.40): Descartes Compendium
  24 candidates → 14 recovered (incl. the p31 schisma pie now on the page);
  Zhu vol 1 → 2; Zhu vols 2–3/4–5 had no eligible candidates. Full #3165 sweep
  (~$155–235) remains ON HOLD by Derek's call.
- Plate-review artifact (all 23 verified candidates, per-station verdicts, rejects):
  https://claude.ai/code/artifact/b847020f-71ca-4cba-9f5f-ed57abd61d39

## Verification

- `npx tsc --noEmit` clean; Playwright pass against the Vercel preview (15/15 images,
  hammer-pair verdict text, Kepler hotspot select, Zhu conditional reveal, Euler
  plate absent pre-trial, no page errors). One visual fix from screenshots: staff
  SVG needed max-width + solid stroke.
- Playwright note: repo has `playwright` but no browsers for its pinned version —
  point `executablePath` at the newest `~/Library/Caches/ms-playwright/
  chromium_headless_shell-*` instead of downloading.
- Vercel PR check did its usual first-fail-then-retry-pass dance (documented in
  CLAUDE.md); trust test/DCO.

## Gotchas hit (also in auto-memory)

- Gallery `description` fields can badly undersell a plate — "musical experiment
  with weights and strings" was actually Kircher's consonance-as-pendulums figure,
  which filled the one station with no native image. Verify plates by eye before
  judging them.
- Node resolves imports from the script's own path: scratchpad `.mjs` scripts can't
  see repo `node_modules` — copy to repo root as `_tmp-*` (untracked) to run.
- Fresh-worktree `check-imports` failure on gitignored `lamejs-bundle.js` bit again;
  the `cp` from the main checkout must not be silenced with `2>/dev/null` (mine
  failed silently the first time — `src/lib/vendor/` didn't exist yet; mkdir first).

## CLAUDE.md check

No new repo-wide invariant: the lessons are station-/workflow-specific and now live
in `project_sound_laboratory.md` (auto-memory) + this handoff. The two CRITICAL
patterns touched (Vercel first-fail retry, worktree lamejs copy) are already
documented in CLAUDE.md.

## Open

- #3160: Salmon three-temperaments upgrade; opt-in aggregate results (product call).
- #3165: full stranded-pages sweep, pending spend approval.
- The `fix+bph-catalog-hidden-read-links` worktree sits clean with no PR (reaper
  keeps it as "left for iteration") — decide keep or kill next session.

## Addendum (same night): post-ship crit → corrections PR #3205 (merged, deployed)

Derek asked for a self-crit; verification of the quoted pages against OCR found real
errors, fixed in #3205:
- Gaffurius has SIX hammers (4/6/8/9/12/16) — VIIII was missing from Station I.
  Bonus now in copy: 9:4 is a perfect square, the one pair whose promised interval
  (a fifth) survives √tension physics.
- "Necessariò quintam sonabit" (Musurgia II p382) is the WIND-HARP chapter — wind
  dividing one string — not a sympathetic-fifth promise. Station VIII copy now
  attributes the fifth-answers prediction to shared-partials physics, grounded in
  his division arithmetic. Demo sourceHref back to book level.
- Tartini presets no longer claim to be the p177 figures (those work
  major/minor-tone cases).
- nature-of-harmony → sound-laboratory cross-link added (7/16 handoff open item).
- Mobile pass (390px): no overflow, hotspots align, no page errors.

Meta-lesson worth keeping: **verify quoted source text via OCR/get_quote BEFORE it
ships in UI copy, not after** — the quote-integrity rules apply to captions and demo
copy exactly as much as to essays. Both errors were the predictable product of
reading cropped images instead of the page text.

Still genuinely unverified: nobody has LISTENED to the smithy ensemble or the
six-planet choir on real speakers (gain arithmetic says no clipping: 6×0.22 and
6×0.16 voices against master 0.22 both peak <0.3). First human listen = Derek.
