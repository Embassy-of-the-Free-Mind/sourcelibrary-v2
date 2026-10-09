---
stage: translation
measure: [accuracy, judged]
languages: []
scripts: []
canons: []
n_books: 320
n_pages: 320
verdict: "v15 lifts verified original-note rate 66.7% to 96.3% but cuts interpretive notes by a third and loses 8:1 to a blind judge; not flipped, v16 follows."
status: rejected
decision: "v15 not flipped; v13 stays; v16 also not established (PR #5703)"
superseded_by: null
issue: 3825
---
## 2026-09-12 — Does translation prompt v15 (#3825) make original-notes real?

**Headline: the verbatim rule works — verified-note rate 66.7% → 96.3% while
writing MORE notes — but v15 also suppresses interpretive notes by a third, and
the blind judge caught it. Not flipped; v16 = v15 + one sentence.**

- **Question.** v15 carries all five #3825 items; item 2 says the phrase inside
  `<note>original: "…"</note>` is copied character-for-character from the OCR
  or the note is omitted. Does it cut fabricated citations (12.2%, #3308)
  without gaming the metric by falling silent, and without losing content?
- **Design.** Pre-registered (`PREREGISTRATION-translation-prompt-v15.md`).
  Paired, one page per BOOK, 8 strata × 40 = 320 pages, both arms on
  `gemini-3.1-flash-lite` (flat, Derek's call — the full-flash routing rests on
  OCR evidence; #4759). Verifier = `scripts/lib/page-terms-parse.mjs`, the
  build-page-terms one. Blind 30-pair Claude judge on loss. $1.26.
- **Result.** Criteria 1–3, 5 pass: Δ +28.9 pp (CI [+14.2, +44.5]; recomputed
  2026-09-30, #5373, was [+14.7, +44.7]), sign test
  13–0; original-notes/page 0.42 → 0.77; invented tags −95%, housekeeping
  leakage −91%, inline terms +22%. Hebrew went 8% → 93% verified, Arabic
  29% → 100%: on those scripts v13's citations were mostly fabricated.
  Criterion 4 (body −26%) FAILS as written but is two v13 runaway loops
  (MAX_TOKENS, 96K/138K chars) that v15 refused with `<warning>`; excluding
  them −0.3%. Criterion 6 FAILS: judge 8:1 against v15 — 4 are running
  headers not reproduced (item 4 by design), 3 are interpretive notes not
  written. Corpus-wide interpretive notes fall 1.27 → 0.81/page, every
  stratum. The "omit the note" clause is being read beyond `original:`.
- **Replicated?** No. k=1 per (page, arm), one run.
- **One label changes with the recomputed intervals (#5373).** The report marked
  the invented-tag reduction (0.25 → 0.01 per page) as NOT decisive, CI
  [−0.525, 0]. On a sound generator it is [−0.594, −0.003]: decisive, by one
  page in 320. It is a regression gate in the favourable direction, so no
  criterion and no recommendation changes. The stored 2026-09-12 report keeps
  its original intervals (the verifier has changed since; reproduce it at
  d49c98985 with `PAIRED_STATS_LEGACY_LCG=1`).
- **Two instrument lessons.** (a) `<[^>]+>` as a tag stripper eats prose
  between `->centred<-` markers — fixed, control added. (b) A mean body
  length cannot carry a runaway-loop failure; `prompt-ab.mjs` said so in
  September and the plan did not inherit it. Amendment 1, prospective.
- **Artifact.** `results/translation-prompt-v15-report-2026-09-12.md` (+ .json,
  arms, judge packet/key/verdicts), PR #4758. v15 row stays `is_default:false`.
