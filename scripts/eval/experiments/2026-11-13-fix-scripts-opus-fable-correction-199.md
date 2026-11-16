---
stage: ocr
measure: [judged]
languages: [grc, el, ar, he, sa, hy, fa, gez, ru]
scripts: [Grek, Arab, Hebr, Deva, Armn, Ethi, Cyrl]
canons: []
n_books: 217
n_pages: 699
verdict: "On non-Latin, non-CJK pages that our checks had measured as seriously wrong, Claude correcting the stored text against the image is better than leaving it. In the cell test (Greek, 3 Flash drafts, 30 pages, one per book) both correctors passed: Opus 20 better / 8 same / 0 worse (Fable judge), Fable 26 / 3 / 0 (Opus judge), and all wrong-page controls were refused. The bulk then wrote 699 pages (333 Opus, 366 Fable). In the 80 audit pages (10 random writes per wave, judged blind) 75 were better than the text they replaced, 5 the same and 0 worse. The audits of the Opus waves 7-8 used an Opus judge (same family). The 97 Opus manuscript pages still need a cross-family (Gemini) re-check."
status: informational
feeds: [repair]
supersedes: []
superseded_by: null
issue: [199, 8632, 7263]
router_evidence: "none — a correction pass over measured-bad pages, not a route compared against the router's live cell; the corrector arms (Opus, Fable) are not router lanes"
defect_rates: "none — judged accept/fidelity per page against the stored text, not misleads per 1,000 words"
---
## 2026-11-13 · Does a Claude correction against the image beat the stored text on measured-bad non-Latin pages? (v3#199)

PRIOR ART: `scripts/eval/error-zoo/repair-pilot/` (the last repair attempt, which stopped before bulk) and the
`paired-arm-judge` recipe over `scripts/eval/route-judge-6740/judge.mjs` + `paired-arm.mjs`. No new tool was
built. The correction is `scripts/batch/ocr-convergence/correct.mjs`, the write is `scripts/batch/cli-ocr.mjs apply`,
the audit rows go through `recordPageVerdicts`, and containment uses `hold-pipeline-books.mjs` +
`withhold-stale-translations.mjs`. The three job-scratch drivers (`jd.mjs`, `audit.mjs`, `report.mjs`) are kept as
the record in `scripts/eval/route-judge-6740/results/fix-scripts-199/`.

**Who it is for.** Readers of Greek, Arabic, Hebrew, Sanskrit, Armenian, Persian and Ge'ez books whose pages our
checks had read against the scan and marked serious (v2#8632). Until this run nothing had repaired them.

### Worklist
887 pages in 217 books had been flagged serious on served, unchanged text. Before ordering by
`book-check-priority.mjs`, these were dropped: held books, human-edited pages, `cell-test-flash3` writes, the first 50
fix-verdict books (being checked by fix-feed-8255), and 29 hieroglyphic/Demotic/Maya pages.

### Cell test (pre-registered on #199)
Greek × 3-Flash draft × script unknown, 30 pages, one per book. No model judged its own correction.

| | stored | Opus (Fable judge) | Fable (Opus judge) |
|---|---|---|---|
| accepted | 4/30 by each judge | 16/28 | 26/29 |
| mean fidelity | 2.73 / 2.90 | 3.71 | 4.48 |
| better / same / worse | | 20 / 8 / 0 | 26 / 3 / 0 |
| accepts gained / lost | | 12 / 0 | 22 / 0 |
| wrong-page controls refused | 2/2, 2/2 | 2/2 | 2/2 |

Noise floor: across 5 repeated judgments per judge, no accept flipped. Both arms passed (at most 2 worse, gains greater
than losses). Fable was the stronger corrector here even under the Opus judge, which leans toward Opus (#7263). The bulk
used Fable until Derek stopped all Fable calls at 10:53Z, and Opus after that.

### Bulk (waves of ≤150, `--concurrency=3`)
| run | corrector | written | audit judge | better/same/worse |
|---|---|---:|---|---|
| fix-scripts-test-ocr | 9 Opus, 16 Fable | 25 | (the test) | |
| fix-scripts-w1-ocr | Opus | 113 | Fable | 8/2/0 |
| fix-scripts-w2-ocr | Fable | 97 | Opus | 10/0/0 |
| fix-scripts-w3-ocr | Fable | 126 | Opus | 9/1/0 |
| fix-scripts-w4-ocr | Fable | 55 | Opus | 10/0/0 |
| fix-scripts-w5-ocr | Fable | 31 | Opus | 10/0/0 |
| fix-scripts-w6-ocr | Fable | 41 | Opus | 9/1/0 |
| fix-scripts-w7-ocr | Opus | 129 | Opus (same family) | 10/0/0 |
| fix-scripts-w8-ocr | Opus | 82 | Opus (same family) | 9/1/0 |

Not written: 30 UNCHANGED, 37 CONTAIN, and 87 refused by the writer's guards (84 under 40% shared words). No guard was
weakened. Six books were held, and English was withheld on the pages confirmed by eye (13 images opened). One kind of
error recurred: a stored "transcription" of a Greek catena manuscript (Theophylact, Bodleian Auct. E.1.6) writes out
the full biblical text, here Galatians 1:1–24 and Hebrews 9:2–5, where the leaf has only lemmata and commentary.

### What it does not settle
- 97 manuscript pages corrected by Opus (`ms-opus-awaiting-recheck.jsonl`) were checked only by a Claude judge. The
  Opus judge favours Opus manuscript readings by about 43 points (#7263). The 130 Fable manuscript pages are also
  Claude-checked only. Both need a Gemini second read after the pools reset (`gemini-second-read-page-ids.txt`, 699 ids).
- The English on every written page is marked stale (`fix-scripts-199`) and waits for the agy lane. Claude did not translate.
