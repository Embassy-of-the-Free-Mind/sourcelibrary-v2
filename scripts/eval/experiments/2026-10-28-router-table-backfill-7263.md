---
stage: ocr
measure: [judged]
languages: [de, fr, zh, el, sa, ar]
scripts: [Latf, Latn, Hani, Grek, Deva, Arab]
canons: []
n_books: 103
n_pages: 1135
verdict: "Bookkeeping, no model calls. The judged route tests of 2026-10-27/28 are now router-table evidence. #7568 (correct vs re-read, waves 1–2) and #7517 (fresh Flash-low read) are ingested; eleven other tests are not, each for a stated reason. One decision changed. German Flash-Lite goes from switch → lite>agy-flash-low back to keep lite>opus. #7568's German wave adds 10 books on the Opus correction (244/250 not misleading) and none on the agy correction. P(agy within 0.08 of the best) drops from 0.907 to 0.891, against a 0.90 bar, so this is a knife edge. At margin 0.10 the cell still switches. Four new cells (zh, el, sa, ar Flash-Lite) come out HOLD → lite>opus (Greek held). The best route there is the Opus correction, at 0.76–0.83 acceptance with 3–10 books of evidence. The fresh agy read is far behind in every cell (German 0.62, French 0.75)."
status: undecided
decision: "Router table rebuilt as scripts/eval/estimator/router-table/2026-10-28-backfill.md/.json (before: 2026-10-28). It is a proposal: no routing-table or page writes, and ocr-routing-table.json / translation-routing-table.json are untouched (#6688, #7075). Next test for German Flash-Lite: lite>agy-flash-low on #7568's 250 German pages (stored lite drafts, ~270 agy calls plus the Opus judge), so both correctors are measured on the same pages."
superseded_by: null
issue: [7263, 6740, 7568, 7517]
---
## 2026-10-28 · Router table backfill: the 10-27/28 judged tests as evidence (#7263)

PRIOR ART: `scripts/eval/estimator/router-table/` (`build.py`, `rules.json`; #7417, #7588) is the table these tests feed. `scripts/eval/route-judge-6740/judge.mjs` defines the score.json schema. `scripts/eval/flash-reread-5924/w-score.mjs` unblinds #7568. Neither of those wrote router-table evidence, so the results stayed in experiment files.

**Why.** Derek, 2026-10-28: "are all of these tests ... updating the bayesian estimates". They were not. The table's evidence stopped at router-tests-2026-10-26, tibetan-30-2026-10-27 and the Tibetan translation router.

**Method.** `router-table/evidence/derive_backfill.py` reads only the stored verdict files and writes route-judge-format score.json files beside itself. Each file has a provenance line.
- **#7568** (`flash-reread-5924/results-7568/<lang>/step-t.json`): one blind Opus reader per book judged three texts per page against the image.
  - wrong text = *misleading* (a meaning change, an omitted passage, or another leaf's text: route-judge's `wrong_text` severity).
  - accept = not misleading.
  - In these files every misleading verdict carries a material defect, and every not_this_leaf is misleading, so the cut is unambiguous.
  - Check against route-judge on the same kind of page: German lite was accepted 21/30 in the router tests and 187/250 (75%) here. Latin lite was 17/30 in the pilot and 139/250 (56%) not misleading in #5924.
- **#7517** (`route-judge-6740/results/fresh-7517-2026-10-27/`): the route-judge itself. Following the experiment's rule, a read that Gemini's filter cut counts as not accepted, because it is never written: German 16/30, French 23/30. The lite and lite>agy-flash-low rows on those pages are already in the table, so they are not repeated.
- **`build.py`: per-source book scaling.** Each evidence source's pages are scaled by its own books / pages, for the posterior and for the wrong-text gate. Before, pooled sources were scaled together, and wrong text was a raw page count. Without the change, #7568's 25 pages a book would have outweighed the router tests' one page a book by 8 to 1. With the old rules.json the rebuilt table equals 2026-10-28 on every decision.
- **New stage `agy-read`**: a fresh agy Flash-low read, 1.08 calls a page (#7568: 1,166 calls for 1,075 pages).
- **New cells**: zh-lite, greek-lite, sanskrit-lite and arabic-lite, with pages waiting from the 10-25 draft census.
  - Sanskrit was not in that census, so it was counted on 2026-10-28 with the same script: 39,499 lite pages.
  - current = the served lite text.
  - greek-lite carries the greek-flash3 hold (#6694).

**Result** (old → new posterior mean [90%]; decision)

| cell | route | old | new | decision |
|---|---|---|---|---|
| German Flash-Lite | lite | 21/30 0.69 | 208/280 0.70 [0.58, 0.81] | **switch → lite>agy-flash-low ⇒ keep lite>opus** |
| | lite>opus | 28/30 0.93 | 272/280 0.94 [0.87, 0.99] | |
| | lite>agy-flash-low | 28/30 0.93 | unchanged | |
| | agy-flash-low-read (new) | — | 243/280 0.62 [0.50, 0.74] | |
| French Flash-Lite | agy-flash-low-read (new) | — | 23/30 0.75 [0.62, 0.86] | switch → lite>agy-flash-low (unchanged) |
| Chinese Flash-Lite (new) | lite / lite>opus / read | — | 0.34 / **0.76** [0.42, 0.98] / 0.51 | HOLD → lite>opus |
| Greek Flash-Lite, MSS (new) | | — | 0.10 / **0.63** / 0.18 | held |
| Sanskrit Flash-Lite (new) | | — | 0.22 / **0.83** [0.63, 0.97] / 0.50 | HOLD → lite>opus |
| Arabic Flash-Lite (new) | | — | 0.27 / **0.77** [0.55, 0.93] / 0.44 | HOLD → lite>opus |

All other cells are unchanged. Test-next is unchanged: chinese-flash3, latin-lite, latin-flash3.

**The German change is a knife edge.**
- The gate asks P(acc_agy ≥ acc_best − 0.08) ≥ 0.9. That probability was 0.907 and is now 0.891 (200K draws).
- All the new evidence is on Opus: 10 books, 6/250 misleading. The agy correction still has only its 30 router-test pages.
- At margin 0.10 the table still picks agy (acceptance −0.01, 1.8× cheaper per accepted page).
- Under the raw-page wrong-text rate the old code used, agy would also fail the wrong-text bar: 2/30 = 0.067 against 7/280 + 0.04 = 0.065.
- Read it as "the agy correction is under-measured next to Opus", not as "agy is worse". The cheap way to settle it is to run lite>agy-flash-low on #7568's 250 German pages and judge them.

**Not ingested** (reasons in the #7263 comment):
- #7522 and #7503 pages-per-call: a "usable" judge with neighbour images, and no draft route judged on the same pages.
- #6740 pages-per-call: re-reads of the router tests' own de-lite pages (pseudo-replication), and 2 a call is not a lane.
- #6948 Opus image-attached, leaf translation and re-translate: a bad/not-bad translation audit, or by eye only; held books.
- #6560 Flash-pass production, severity recheck, and the 10-26 Tibetan gates: better/same/worse span judgments, not acceptance.
- #7503 Siku pilot and #7570: CER or accuracy against a text key.
- #7341 Kraus: one book, no cell.
- #5771: split cuts, not OCR.
- #7567, gpu-flash-vs-opus-7263 and agy-shift-7263 ingest their own results.
- #5924 (Latin, 2026-10-24) is outside this window and the same instrument as #7568. It is the next candidate for latin-lite.

Files: `scripts/eval/estimator/router-table/evidence/` (`derive_backfill.py`, `correct-vs-reread-7568.score.json`, `fresh-7517.score.json`), `rules.json`, `build.py`, `2026-10-28-backfill.{md,json}`.
