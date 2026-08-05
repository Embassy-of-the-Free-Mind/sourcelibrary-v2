# A classifier over images cannot validate itself

**Read this when:** Writing a detector over page images, splitting spreads (`src/lib/spread-guard.ts`), or running a corpus-wide image repair sweep.

*Split out of `CLAUDE.md` on 2026-08-04. The text is unchanged apart from cross-references repointed to their new files. See `.claude/docs/knowledge-layer.md` for why this tier exists.*

---

Lessons from the false-split repair, 2026-08-04 (#3562). A reader reported one
half-rendered frontispiece. Finding the rest took **seven detectors, four of which
shipped confident wrong answers**, and every single failure was caught by opening an
image — never by a check that inspected data. Full postmortem:
`.claude/handoffs/2026-08-04-false-split-repair-and-seven-detectors.md`.

- **Never quote a detector's count before validating it against eyes.** The successive
  answers were 1,046 → 10,277 → 567 → 470. Three of the four largest "findings" were
  artifacts. Sweeping on the first would have stripped correct crops off hundreds of
  properly split spreads. **Sort the review by risk** (most-suspicious first) so a
  partial human pass is still maximally informative — 97 wrongly un-split spreads were
  spotted in seconds that way, by a human, after the classifier had passed every one.
- **Absolute thresholds fail wherever the population varies per item.** Leaf proportions
  differ enormously between books: a spread of two narrow folio leaves (1415x3106 each)
  is 2780x3105 — still taller than wide, so `w > h` flagged all 543 correctly split
  pages of one book. Calibrate against the item's own population, and **abstain in the
  ambiguous band** rather than let nearest-neighbour force a verdict (real spreads sat
  at 1.32x and 1.40x where the classes are 1x and 2x).
- **A reference set can be contaminated by the defect it is meant to calibrate.**
  "Uncropped pages are single leaves" is false — in a partly-split book the unsplit
  pages may be spreads nobody got to. One book drew its yardstick from 24 uncropped
  pages that were *all* spreads, and its real spreads then read as damage.
- **Check what the system already wrote down before inventing a signal.** The thing that
  finally worked was the OCR model's own `<warning>` text — *"an extremely narrow
  vertical fragment… truncated on both the left and right sides"* — recorded at write
  time in February and never read. It needs no image fetching and works where shape
  cannot. Same shape as the crawler-fleet and analytics lessons (`crawler-access-gate.md`, `measurement-instruments.md`): the evidence
  existed; nothing surfaced it. Corollary: **absence of a complaint is not health** — a
  model fed a clean half-page transcribes it without remark.
- **A repair verified on a sample is not verified.** "Confirmed in production" was true
  for the two books checked and false for a third of the rest: clearing `crop` +
  `cropped_photo` falls through to `display_photo`, which for 196 of 567 pages was
  itself a resize of the half. The pages read as repaired in Mongo and changed nothing
  on screen.
- **A count of zero needs its denominator checked before it means anything.** A
  post-apply check reported "0 pages still carrying crop" from a query that matched
  *nothing* — the backup serialises `_id` as a hex string while Mongo stores an
  ObjectId, so `{_id: {$in: [<strings>]}}` matches zero documents and the zero reads as
  success. Assert the match count equals the expected count in the same breath.
- **A bare failure count hides its own cause.** A re-OCR run reported 27 of 54 failed;
  the reason (`"API key not valid"` — two of four Gemini keys are dead, #3627) sat in
  `gemini_usage.error_message` throughout. Surface distinct error messages in run
  summaries, and drop a key on a permanent 400 instead of rotating back into it.

Corollary of the invented-fixture rule (`tests-that-are-not-guards.md`), met the hard way: the first version of
`tests/unit/spread-guard.test.ts` failed because the FIXTURE was unrealistic (an
11%-wide gutter puts the detector's flank-confirmation window entirely inside the
gutter), not because the detector was wrong. Check the fixture against a real image
before concluding the code is broken.

**Splitting specifically:** `src/lib/spread-guard.ts` refuses to split an image that is
not a spread, using content (a central ink-free channel with text on *both* sides) not
shape. It ships in `report` mode — log a real batch and confirm the refusals before
setting `SPLIT_SPREAD_GUARD=enforce`, because BPH books genuinely are mostly spreads.
Note a false split also runs `$unset: { ocr, translation, summary }`, so it is never
merely cosmetic.
