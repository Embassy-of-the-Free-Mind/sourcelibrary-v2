---
stage: ocr
measure: judged
languages: [la]
scripts: [Latn]
canons: []
n_books: 10
n_pages: 250
verdict: "We had Opus correct the stored lite transcription in place (correct.mjs, #6694 arm B) on the same 250 lite-read Latin pages as the Flash re-read test. Blind Opus readers called 31/250 corrected pages misleading, against 111/250 for lite. 25 of those 31 are the wrong-leaf book, and the corrector put all 25 of its pages in CONTAIN, so the page served is still the lite text. On the other 9 books the counts are 6/225 corrected vs 86/225 lite. One page was worse than lite: lib. 2 → lib. 1, the same misread the Flash re-read made on that page, confirmed by eye. Flash had 7 worse pages. Head to head with the Flash re-read, the readers preferred the correction on 131 pages and Flash on 43, with 76 ties. Misleading counts were 5 for the correction and 28 for Flash on the 225 pages outside the wrong-leaf book. There were no line drops, no refusals and no false contains. Every judge was an Opus reader, from the same family as the corrector, so self-preference is not ruled out."
status: informational
decision: "No production write. The strict bar ('no page worse') fails on 1 page, so as registered no plan is adopted. Correction beats the Flash re-read on every measure here. If Derek accepts it as the upgrade path for lite Latin, it costs about 1% of one Claude account-week per 250 pages, so about 18 account-weeks for the 444K lite pages (meter granularity puts it between 9 and 27). That is Claude subscription time, not agy, and it adds the same ~$450 of gap-fill retranslation as any OCR write."
superseded_by: null
issue: [5924]
---
## 2026-10-24 · Opus correction of the lite text vs the Flash re-read, on the same 250 lite-read Latin pages (#5924)
<!-- PRIOR ART: 2026-10-23-flash-reread-lite-latin-books-5924.md (the test this adds an arm to: lite 102 → Flash 20 misleading, 7 pages worse) and 2026-10-13-ocr-opus-correct-vs-lane-b-q300-6694.md (correction beat a fresh read 158–6). -->

**Question.** The Flash re-read cut misleading lite pages from 102 to 20 of 250, but 7 pages came out worse: 3 were recitation cuts, and 4 were real misreads, including a dropped line and 4 skipped lines. A correction starts from a draft that has every line. Does Opus correcting the stored lite text clear the bar the Flash re-read failed? And how does it compare with the Flash re-read head to head?

**Design** (`scripts/eval/flash-reread-5924/PREREGISTRATION-opus-correct.md`, committed 273aa9b3a before any correction).
- **Pages.** The same 250 pages, 10 books × 25 spread pages. The stored `ocr.data` still equalled the judged lite text on 250/250 (`results/oc-stored-check.json`).
- **Arm O.** `correct.mjs --model=opus --per-call=10 --concurrency=3`, unchanged: the live OCR prompt plus its correction block, a sealed `claude -p --restricted --tools Read`, and the opened-files check.
  - O serves its corrected text where it made a correction. Otherwise it serves the stored lite text, because `apply` writes only corrections.
- **Step C2 (O vs L).** One fresh blind Opus reader per book read the 209 pages where O differs from L, with X/Y sides from Mulberry32(1024).
  - On the 41 pages where O equals L, both arms take the original Step C's L verdict.
- **Step C3 (O vs F).** One fresh blind reader per book read all 250 pages against the Flash reads the original run produced, with sides from Mulberry32(1025).
- **Protocol.** Both steps used the original `VERDICTS.md` / `C-TASK.md` and the reader prompt verbatim.
- **(d) Second-family judge: not run.** l7a has no agy meter, no `ops_reports` row publishes one, and l7a's agy is not signed in. **The result is single-family.**

**Outcomes** (`results/oc-outcomes.json`)
- **corrected 209 · unchanged 16 · contain 25 · no-answer 0.**
- 30 calls. No retries, no usage stop, no chatter-guard cuts.
- All 25 contains are the wrong-leaf book `69bd9d05…`, which is already held from #5924. Each reason names the leaf the draft actually is (for example "the draft gives the text of p. 5 … not this page, which is p. 4").
  - **True contains 25/25, false contains 0.**
- Of the 16 UNCHANGED pages, 1 was misleading lite: `69b51e7f` p162, *valdè* for *validè*. Correction let it stand.

**Result** (`results/oc-score.json`; Wilson 95%)

| 250 pages | misleading | worse than lite | blind preference |
|---|---|---|---|
| lite (L), Step C2 | **111** (38–51%) | — | — |
| Flash re-read (F), original Step C | 20 (5–12%) | **7** (3 recitation cuts + 4 misreads) | F 201 · L 23 · tie 26 |
| **Opus correction (O), Step C2** | **31** (9–17%) | **1** | **O 201 · L 2 · tie 47** |
| O vs F head to head, Step C3 | O **30** · F **32** | — | **O 131 · F 43 · tie 76** |
| *without the wrong-leaf book (225)* | L 86 (32–45%) · **O 6 (1–6%)** · C3: O 5 vs F 28 (9–17%) | O 1 | C3: O 131 · F 18 · tie 76 |

- **Bar (a), halves: PASS.** 31 ≤ 55.5.
- **Bar (b), no page worse: FAIL, on 1 page.** `69b51e67` p131: *Petrus Matthæus … lib. 2.* became *lib. 1.*
  - I checked it by eye. The glyph is this fount's 2, the same as in *pag. 2.* above it.
  - The Flash re-read made the same misread on this page, so the glyph misleads both vision models.
  - There were no no-answers, false contains or guard cuts. Flash's 7 worse pages include 3 such cuts.
- **Bar (c), vs F: O ahead on both counts.** Misleading is 30 vs 32 overall and 5 vs 28 outside the wrong-leaf book. Preference is 131 to 43.
  - Material losses: F lost meaning that O kept on 37 pages; O lost meaning that F kept on 5 pages outside the wrong-leaf book.
  - Those 5 are p40 *lib. 17 → 27*, p639 *niti → nisi*, p162 *validè* (the UNCHANGED page), p266 (a letter-value table O left out) and p41.
  - O vs F is 30 vs 32 overall because on the wrong-leaf book O serves the wrong leaf (L) while its contain holds the book. There Flash reads the right leaf, apart from 4 recitation cuts.
- **The preregistered rule** ((a) and (b) and (c)) **is not met**, only because of bar (b)'s single page. Correction is the better upgrade path on every measure of this test.
- **Facing strip:** visible on 50 C2 pages. L read it in on 8, O on 0; in C3, O 0 and F 0.
- **Reader agreement.** On the 209 shown pages, the C2 reader and the original Step C reader agreed on L misleading 70 times; C2 only 15, original only 6.
  - On F, the C3 and original readers agreed 16 times; C3 only 16, original only 4. Next to a stronger O, the readers judged F harder: 32 misleading here vs 20 in the original.
- **Self-preference caveat.** Opus corrected and Opus judged. The 201–2 preference over lite is the number most exposed to this.
  - The misleading verdicts each quote the wrong words against the print, and the 1 worse page and the 7 by-eye pages below were checked against the image.

**By eye** (image open, zoomed)
- **The 4 pages Flash made worse:**
  - `69b51e67` p131: O made the same *lib. 2 → 1* misread (above). This is O's only worse page.
  - `69b51e18` p353: Flash skipped about 4 lines of Jerome's gloss. O keeps every line, from *ait Hierony:* through *Ieremias cap. 3* and *Erubescant igitur hæretici*. It fixes L's *poca* to *voca* and *fis/fatis* to *sis/satis*, and places the side-note *Ierem.* at its line.
  - `69b51eba` p49: Flash wrote *intelligibilem*. O reads *intelligentem Plato statuit* as printed, and restores L's dropped nasal marks (*mundum, animatum*) and *sit* for *fit*.
  - `69b638be` p174: Flash dropped the last printed line. O keeps *as qualia aures mee ex amore ſpōſe audierunt* and the abbreviation marks.
- **3 random corrected pages** (Mulberry32(1026)):
  - `69b51e67` p698: O fixes *facienda → sancienda*, *Desterreich unterin → Oesterreich untern*, *Jesuita → Jesuitæ* and *aquè → æquè*, and adds italics.
    - Two slips in the furniture: the catchword *sacr* is tagged but placed at the top of the page, and `<language>` loses *German* although *Bedencken* is printed in Fraktur.
  - `69bd9d72` p196: two fixes (*actua → actiua*, *dū → dum*). It was already sound.
  - `69bd9d72` p347: O fixes *fit → sit*, *significat → significant* and *plicara → plicata*, and tags the catchword.

**Cost** (Claude subscription, account derek@sourcelibrary.org on l7a; $0 billed)
- **The correction run:** 250 pages in 30 calls, 23 min wall. 453K output tokens, 4.1M cache-read tokens. The list-price equivalent is $20.28, or $0.081 a page.
- **Meter (climits, integer %):**
  - The correction moved the 5-hour window from 42 to about 48, and the week from 31 to 32 at most.
  - The whole job, correction plus 19 readers, moved the week from 31 to 37 and the 5-hour window from 42 to 79. Three other jobs were live on the same account, so these are upper bounds.
- **Projection to the 444K lite pages:**
  - About 1% of an account-week per 250 pages, so about **18 account-weeks**. The meter's 1-point granularity gives a range of 9–27.
  - In a single account's 5-hour window, about 4,000 pages fit. The weekly limit binds first, at about 25K pages per account-week.
  - With four accounts that also carry other work, that is months, not weeks. It runs on Claude, so it does not compete with the agy lanes, which the Flash path's ~85 days of the Google account's quota would.
  - Either path adds the same ~$450 lite Batch gap-fill retranslation.

**Grade.** Exploratory: 10 books, single-family judges, no human calibration.

Files: `scripts/eval/flash-reread-5924/`
- Scripts: `PREREGISTRATION-opus-correct.md`, `oc-set.mjs`, `oc-pairs.mjs`, `oc-score.mjs`.
- `results/`: `oc-stored-check.json`, `oc-outcomes.json`, `oc-step-c2.json`, `oc-step-c3.json`, `oc-score.json`, `oc-reads.jsonl.gz` (the corrections and their meta).
