# Preregistration amendment: Opus correction of the lite text, a third arm on the same 250 pages (#5924)

PRIOR ART: `PREREGISTRATION.md` here (f9a56e374, the Flash re-read test this amends; its sample, verdict definitions
and Step C protocol are reused unchanged), `scripts/batch/ocr-convergence/correct.mjs` (#6694 arm B, the corrector,
run unchanged) and `scripts/eval/experiments/2026-10-13-ocr-opus-correct-vs-lane-b-q300-6694.md` (correction beat a
fresh read 158–6). Committed before any correction runs.

Job `opus-correct-latin-5924`, 2026-10-24. Derek approved the arm 2026-10-24 ("yes"). Grade: **exploratory**, as
the original. No production OCR is written; `cli-ocr.mjs apply` is never called.

## Sample
The same 250 pages (`results/sample.json`, 10 books × 25 spread pages). `oc-set.mjs` checked each page's stored
`ocr.data` against the lite text the Flash test judged (`draw/<slug>.lite.txt`) on 2026-10-24: **250/250 equal**
(`results/oc-stored-check.json`), so no page is dropped.

## Arm O
`correct.mjs --set-dir=… --model=opus --per-call=10 --concurrency=3 --job=opus-correct-latin-5924`, unchanged: the
live OCR prompt plus its correction block, sealed `claude -p --restricted --tools Read`, the transcript check that
each image and draft was opened, the chatter guard. Outcome per page: corrected / unchanged / contain / no-answer.

**The text O serves** (what a reader would get if the corrections were applied): the corrected text where the outcome
is `corrected`; otherwise the stored lite text, since `apply` writes only a correction. A `contain` would also hold
the page; it is scored separately (below).

## Judgments (blind, fresh Opus subagents, image open, crop helper; `agents/VERDICTS.md` and `C-TASK.md` unchanged)
- **Step C2, O vs L.** Per book, one fresh reader, every page where O's served text differs from L. X/Y from
  Mulberry32(1024), drawn per page in sample order. A page where O serves L unchanged is not shown: there O = L by
  construction, and both verdicts are the original Step C's L verdict for that page (same blind protocol, one reader
  for both arms, as on every shown page).
- **Step C3, O vs F.** Per book, one fresh reader, all 250 pages: O's served text against the Flash read the original
  produced (`results/F-reads.jsonl.gz`). X/Y from Mulberry32(1025).
- Controls as the original: no arm names in packets (X/Y only), readers are not the Step A/C readers and see no
  other packet, keys are written to the job scratch and opened only by the scorer.

## Measures and bars
- **(a) halves:** misleading(O) ≤ ½ · misleading(L), pooled over 250 pages, both from Step C2 (with the C rule above
  for unshown pages).
- **(b) no page worse than L:** a page is worse when, in C2, O is misleading and L is not, or the reader prefers L
  with a **material** loss in O; or O's outcome is `no-answer` (parity with the F arm's "unread = worse"); or O is a
  **false contain** (`contain` on a page that neither the original Step A nor Step C marked `not_this_leaf` for L).
  Every such page is listed. The count is reported either way, and chatter-guard / no-answer pages separately (the F
  arm's recitation cuts are their analogue).
- **(c) head-to-head vs F (Step C3):** misleading(O) vs misleading(F), and the preference O / F / tie with material
  losses each way. **Correction is the recommended upgrade path over the Flash re-read** when (a) and (b) pass and,
  in C3, misleading(O) ≤ misleading(F) and O is preferred on more pages than F.
- **(d) second-family judge (agy `gemini-3.8-flash-low`, a seeded 60 pairs): NOT RUN.** The brief allows it only if
  the main box's agy meter shows quota open. That meter (`/root/agy-quota/summary.txt`) is not on this box (l7a), no
  `ops_reports` row publishes it (checked 2026-10-24 02:15Z: no `agy`/`quota` key among 103), and l7a's agy is not
  signed in. **The result is single-family:** Opus corrects and Opus judges, so a self-preference bias in favour of O
  cannot be excluded. Reported as a caveat beside every number.
- Reported, not in the bars: outcome counts; contains, with whether each matches the wrong-leaf book (`69bd9d05…`,
  where L is the next leaf's text on 25/25 pages); per-book rates with Wilson 95% intervals; the agreement of C2's
  and the original C's L verdicts on shown pages; facing-strip handling.

## Cost
Claude usage consumed: the box account's weekly % (climits meter, `/root/.claude-limits/latest.json`) before and
after the correction run, and the run's token totals from `calls.jsonl`. Other jobs share the account, so the meter
delta is an upper bound; the per-page token cost is the measure that projects. The projection to the 444K lite pages
is stated in account-weeks.

## By eye (after scoring)
The 4 pages Flash made worse (`69b51e67` p131, `69b51e18` p353, `69b51eba` p49, `69b638be` p174) and 3 corrected pages
drawn with Mulberry32(1026), opened against the image: what the correction did on each.
