---
stage: ocr
measure: [judged, accuracy]
languages: [la, en]
scripts: [Latn]
canons: []
n_books: 39
n_pages: 60
verdict: "The Latin word-level diff-QA for agy corrections (three-way vote: Flash-Lite draft / agy Flash-low correction / fresh agy Flash-low read, agy Flash-high judge only where they disagree) catches planted swaps (20/20 by vote, 19/20 by the judge alone, judge controls 20/20). But it does not make the corrected pages better than the bare correction, and the route as production would run it loses to lite>agy-flash-low on wrong text. Router frame (30 pages, 9 books): lite 17/30 (12 wrong), lite>agy-flash-low 24/30 (4), round 1 diff-QA 20/30 (10), round 2 diff-QA (post hoc) 20/30 (7), Opus 30/30 (0). Confirmation frame (30 new pages, one per book, rules frozen before the draw): lite 7/30 (22 wrong), lite>agy-flash-low 17/28 (7), diff-QA 11/30 (15). The gate fails. Most of the loss comes from the cli-ocr apply guards (>25% of words changed, foreign script) sending 9/30 and 19/30 pages back to the lite draft. On the pages diff-QA merged, it ties the correction: 20/32 accepted with 6 wrong-text pages, against 23/32 and 6."
status: rejected
decision: "Catalogi (69b51ddb47b06ecd581852a2) is NOT written through diff-QA (Derek's gate, inbox 2026-10-28 09:20Z). The route is registered in rules.json (latin-lite, lite>agy-flash-low+diffqa, stage agy-diffqa); the rebuilt table (2026-10-28-latin-diffqa) keeps lite>opus for latin-lite."
superseded_by: null
issue: [7591, 7517, 6740, 7613]
router_evidence: [latin-lite]
---
## 2026-10-28 · Latin diff-QA with a three-way vote: router eval and positive control (#7591)

PRIOR ART: `scripts/eval/tibetan-correct-6560/pass/diffqa.mjs` (spans / merge / write for Tibetan; Opus leaf
check) is the shape copied. `scripts/eval/route-judge-6740/judge.mjs` is the instrument, unchanged except that a
corrector carrying `calls_per_page` is priced at that many agy calls. `fresh-gate-7517.mjs` gives the #7517 rows.

### The tool
`scripts/lib/latin-diffqa.mjs` (pure, unit-tested in `tests/unit/latin-diffqa.test.ts`) and
`scripts/eval/latin-diffqa-7591/diffqa.mjs` (list / spans / judge-req / judge / merge / write / control).
- Words are aligned on a fold key: ſ→s, æ→ae, œ→oe, v→u, j→i, lower case, edge punctuation out. Whitespace-only
  punctuation tokens and the model's judgement tags (`<language>`, `<page-type>`, `<meta>`, `<vocab>`,
  `<image-desc …>`, …) are not words.
- A run of word-for-word substitutions is split into one span per word.
- **LOW** (kept from the text alone): case and punctuation, joins and splits (hyphenation, `A.D.` = `A. D.`),
  and f↔ſ / s↔ſ (the long-s misread).
- **RISKY**, in order: a line's worth (>6 words, or ±4), a negation count change, a digit, a roman numeral, a
  capitalised word, anything else.
- **Vote** on a RISKY span: the fresh read's words between the nearest correction words it shares on either side
  (up to 4 out) are compared with the correction's and the draft's over the same window. Strict comparison first,
  then with f read as s. The outcome is correction (kept), draft (put back), split or no-anchor (to the judge).
- **Judge**: one agy `gemini-3.8-flash-high` call per page, holding all of the page's split spans as A/B items in
  random order plus one known-answer control (leafcheck.mjs's read-off, worded for print).
- **Write**: through `writePageText`, compare-and-set on the draft, page_revisions under the run id, `ocr.diffqa`.
  It never ran on Catalogi (below).

### Positive control (Catalogi pages, 20 plants on 20 pages: shelfmark ×4, year ×4, page number ×4, name ×4, dropped negation ×4)
Plants go on words that the draft and the correction agree on, at least 8 words from any change.
- **With the fresh read: 20/20 put back**, all by vote. The 15 judged pages' controls: 14/15 right.
- **Judge alone** (`--drop-fresh`, all 603 RISKY spans of those pages to the judge): **19/20**. It missed the
  name swap Physick → Pyhsick. Controls: 20/20 right.
- Vote and judge agree on 373/420 voted natural spans (89%): 279 correction/correction, 94 draft/draft, 22 + 23
  opposite, 2 other.

### Router eval: frame 1, the 30 router-test `latin` pages (router-tests-2026-10-26, 9 books)
Inputs are paired: the stored lite drafts (all 30 unchanged since 2026-10-26) and the stored lite>agy-flash-low
corrections, copied from gex45 `spare-router-tests-6740`. The fresh reads were kept reads of the same model, live
prompt and image (`flash-reread-agy2-5924`, 2026-10-24): no new agy calls. The blind Opus judge's verdicts for
lite / lite>agy-flash-low / lite>opus-correct are reused (same text, same id).

The cli-ocr apply guards (dry run) refuse 9/30 corrections: 4 change over 25% of the words, 3 have letters outside
the book's scripts, 1 changes 2020%, and 1 answers UNCHANGED. Those pages serve the draft.

| route | accept | wrong text | fid | on the 21 guarded-through pages | on the 9 refused |
|---|---|---|---|---|---|
| lite | 17/30 | 12/30 | 3.77 | 11/21, 9 wrong | 6/9, 3 wrong |
| lite>agy-flash-low | 24/30 | 4/30 | 4.20 | 17/21, 3 wrong | 7/9, 1 |
| agy-flash-low (fresh) | 23/30 | 4/30 | 3.83 | 15/21, 4 | 8/9, 0 |
| diff-QA round 1 | 20/30 | 10/30 | 3.97 | 14/21, 7 | = lite |
| diff-QA round 2 (post hoc) | 20/30 | 7/30 | 4.03 | 14/21, 4 | = lite |
| lite>opus-correct | 30/30 | 0/30 | 4.83 | 21/21, 0 | 9/9, 0 |

**Round 1 failed for two reasons, both read off its worse pages:**
1. A META regex bug. `<image-desc size=…>` with attributes was taken for words, so a correction's picture
   description was put back as a span.
2. A judge answer of `other` or `unclear` put the span back. On a roman-numeral table that re-inserted two
   invented ↀ rows that the correction had dropped.

There was one plain judge error: on Greek it said "base" and put garbled μένον back over the right μόνον.

Round 2 puts a span back only on evidence (the fresh read or the judge saw the draft's reading) and fixes the regex.
It was set after seeing round 1 on these pages, so it is post hoc. It still does not beat the bare correction.
Judged sides in round 1: 107 correction / 23 draft / 8 other.

Opus's verdicts move between near-identical texts. In round 2 it flagged a dropped `rerum` on the diff-QA text and
accepted the correction text that also lacks it. At n = 21, differences of 2-3 pages are within that noise.

### Router eval: frame 2, the confirmation (rules frozen before the draw; `preregistration.md`, `frozen-rules.txt`)
`judge.mjs draw --cells=latin-lite`: 30 pages, one per book, 30 books. The correction and the fresh read were made
on the second agy pool (AGY_HOME=/root/.agy-james, flash-low, `--fresh`, CANDIDATE_READS=off). The apply guards
refuse 18/30 corrections; one more page merged with no change. **Pre-registered GO rule:** diff-QA's wrong text <
lite>agy-flash-low's on this frame.

| route | accept | wrong text | fid | on the 11 merged pages | on the 19 others |
|---|---|---|---|---|---|
| lite | 7/30 | 22/30 | 3.07 | 2/11, 9 | 5/19, 13 |
| lite>agy-flash-low | 17/28 | 7/28 | 4.07 | 6/11, 3 | 11/17, 4 |
| agy-flash-low (fresh) | 14/22 delivered (8 cut before <<<END>>>) | 7/22 | 3.82 | 5/7, 1 | 9/15, 6 |
| **diff-QA** | **11/30** | **15/30** | 3.30 | **6/11, 2** | = lite |

**GO rule: 15 > 7 → FAIL. Catalogi is not written.** All wrong-page controls passed in both frames.

Pooled over the merged pages of both frames (round 2 rules): diff-QA 20/32 accepted with 6 wrong-text pages; the
bare correction 23/32 with 6. The vote and the judge do not add a measurable gain over the correction. What
decides the production route is the apply guards, which hand a third to two-thirds of Latin lite pages back to a
draft that carries wrong text on 40-73% of pages.

### Cost
agy calls a page: 2.57 (frame 1), 2.73 (frame 2). That is correction 1, fresh read 1, and a flash-high judge call
on 63% of pages. A judge call thought 4K-86K tokens (median ~28K): it is far heavier than a flash-low read.
Rebuilt table (`router-table/2026-10-28-latin-diffqa.md`): the diff-QA route pools 31/60, 0.52 [0.39, 0.64],
wrong text 22/60, 5.14 agy calls per accepted page. lite>agy-flash-low pools 41/58 (11 wrong); latin-lite keeps
lite>opus.

_Rebased 2026-10-29 (job land-evals, #6740): the table was rebuilt on main's rules.json (margin 0.08, print /
manuscript split, #7588/#7621). This test's two score files have no by-script file yet, so they enter the
`latin-lite/unknown` cell only (diff-QA 31/60 there); `latin-lite/print` still keeps lite>opus._

### Catalogi itself (69b51ddb47b06ecd581852a2, 1,026 Flash-Lite pages)
1,026 fresh reads were made (second pool, 3 readers, about 2 h, no quota stop). On the first 334 corrections, the
apply guards refuse 107 (32%), 37 of them for Greek: the catalogue lists Greek manuscripts. A Catalogi-specific
point: the corrector writes f for long s (Afhmole, defcription) where the draft and the fresh read have s/ſ. The
vote puts those back, which is a real fix on this book. 117 of the 420 voted spans on the 20 control pages were
draft-side votes, most of them of this kind. No Catalogi page was written and no Opus spot check was run, because
there is no merged page to check.

### Containment found on the way (#7613)
The confirmation frame's Opus judge flagged 3 served lite pages as invented; 2 were confirmed by eye.
- *Disputatio Apologetica* p.26: the image is mirrored, and the OCR invents an "Ad lectorem" paragraph and §VI.
- Gafurius p.9: the image is a 2001×220 strip of six openings, and the OCR is invented textbook prose.

Both books are held (`contained-invented-ocr-7591`) and Gafurius p.9's English is withheld. The third
(Manly P. Hall MS 181 p.178, a hard hand with one confabulated clause) is a quality finding, not containment.

### Files
`scripts/eval/route-judge-6740/results/router-tests-diffqa-2026-10-28/`
- `router-frame/`, `confirm-frame/`: judge.mjs sample, key, score, verdicts and fresh-gate.
- `diffqa/`: spans, merge rows without the texts, and the control plants and scores.
- `preregistration.md`, `frozen-rules.txt`.

Texts and images stay in the job scratch (`/mnt/HC_Volume_105839809/jobs/latin-diffqa-7591`).
