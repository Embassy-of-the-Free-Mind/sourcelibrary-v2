---
stage: ocr
measure: [judged]
languages: [fr, es, it]
scripts: [Latn]
canons: []
n_books: 242
n_pages: 242
verdict: "First reads of French, Spanish and Italian print (1600-1799 and 1800-1929, books with page records only) by LightOnOCR-3-1B draft on gex45, then agy Flash-low correcting with the page image, one page a book, blind Opus judge. Under the rule as committed, no cell passes. French 1800-1929, two draws pooled: 60 drawn, 32 written, 28/32 accepted, 2 wrong text (6.3%), P(acc>=0.8) 0.815. French 1600-1799, pooled: 60, 29, 26/29, 0 wrong, P 0.875. Spanish 1800-1929 (every eligible book): 27, 24, 23/24, 1 wrong (4.2%), P 0.973. Spanish 1600-1799, pooled (frame exhausted): 35, 30, 27/30, 1 wrong, P 0.895. Italian 1800-1929: 30, 21, 18/21, 3 wrong (old-style numerals and fractions), P 0.667. Italian 1600-1799: 30, 19, 16/19, 1 wrong, P 0.587. All 3 wrong-text pages in French 1800-1929 and Spanish 1800-1929 are one harness defect: agy opened a second <<<BEGIN>>> mid-page and unwrapRead let the cut page through with the markers in it (fixed in PR #8296). Counting those reads as refused, French 1800-1929 is 28/30, 0 wrong, P 0.962, and Spanish 1800-1929 is 23/23, P 0.995; both would pass. Wrong-page controls were rejected 18/18; French plants were caught 8/8; Spanish and Italian have no planter. GPU drafts ran at 2,555 pages/h. agy made 233 calls for 226 reads and 155 written pages (1.5 per written page)."
status: undecided
decision: "No production lane (out of scope). Recommended to Derek on #6871: once #8296 merges, give French 1800-1929 and Spanish 1800-1929 (books with page records) the GPU draft > agy Flash-low route; the other four cells stay off the GPU. 138 judge-accepted test pages were written as first reads (holds kept); rejected pages stay unread."
defect_rates: "scripts/eval/route-judge-6740/results/euro-gpu-agy-cells-6871/defect-rates.json"
superseded_by: null
issue: [6871]
router_evidence: "none — score files in scripts/eval/route-judge-6740/results/euro-gpu-agy-cells-6871/ (score, score-draw2, pooled); router table not edited"
---
## 2026-11-07 · French, Spanish and Italian print, 1600-1799 and 1800-1929: may GPU draft > agy Flash-low give first reads? (#6871)

Part of #6871.

PRIOR ART: `2026-11-04-jcb-pre1600-first-read-cell-8049.md` (the same route and rule on pre-1600 JCB print; its harness
`scripts/eval/route-judge-6740/jcb-1600-8049/run.mjs` is reused here with a `--study=euro-6871` frame, not rebuilt),
`2026-10-29-print1800-gpu-engine-lanes-6871.md` (bare GPU reads only; never Spanish), `2026-10-28-gpu-flash-vs-opus-7263.md`
(the router's `french-gpu-7263` evidence).

### Route under test (one per cell)
LightOnOCR-3-1B draft on gex45 (the JCB cell's recipe: `euro-gpu-correct-7567/drive.sh LO`, vLLM util 0.6), then agy
`gemini-3.8-flash-low` correcting with the page image, one page a call (`cli-ocr.mjs read --gpu-draft --correct-prompt`,
template `agy-0601ef30e816f7a7`). The written set is what `cli-ocr.mjs apply --diff-guard=gpu-draft --print-only` would
write. A bare GPU draft is never served.

### Rule (per cell, unchanged from #8049, fixed before judging)
At least 10 judged; wrong text ≤ 4%; P(acc ≥ 0.8) ≥ 0.9 under Beta(1+k, 1+n−k) over written pages; both wrong-page
controls rejected; planted errors not both missed. One page per book, seeded (salt `6871-<cell>`), 30 pages a cell.
A second draw, from books not yet sampled, only for a cell whose first draw comes close (as JCB did for Latin and French).
**The planter knows only la/fr/de: the Spanish and Italian cells have no planted control.** Their judge sensitivity
rests on the wrong-page controls and on the French cells' plants.

### Frame (drawn 2026-11-07, `run.mjs draw --study=euro-6871`)
- Book's first language is the cell's (`firstReadLanguage`); parsed `year` inside the cell (no year, no book; nothing after 1929).
- Page records exist: `pages_state` is not `manifest_only` (see *Where the pages are*).
- Not an unsplit spread (`needs_splitting` and not `split_completed`); not a manuscript (`manuscriptReason`).
- Not held, or held only `scans-only-publish-7270`. Every other hold (a lane, a campaign, a containment, a person's
  decision) is counted, not drawn.
- One page a book with no text and no human edit, between 5% and 95% of the book.

| cell | books in frame | pages owed (counter) | drawn |
|---|---:|---:|---:|
| French 1800-1929 | 562 | 35,678 | 30 |
| French 1600-1799 | 824 | 43,693 | 30 |
| Spanish 1800-1929 | 34 | 7,463 | 27 (every book with an unread body page) |
| Spanish 1600-1799 | 67 | 14,223 | 30 |
| Italian 1800-1929 | 81 | 6,308 | 30 |
| Italian 1600-1799 | 132 | 11,644 | 30 |

### Where the pages are
Unread pages by book counters (`pages_count − pages_ocr`), 2026-11-07, books with a year in the band:

| | manifest-only books (no page records) | books with page records |
|---|---:|---:|
| French 1800-1929 | 1,132,382 (2,547 books) | 46,807 (625) |
| French 1600-1799 | 2,584,001 (9,581) | 81,818 (961) |
| Spanish 1800-1929 | 3,818 (14) | 8,059 (37) |
| Spanish 1600-1799 | 34,695 (116) | 16,332 (73) |
| Italian 1800-1929 | 227,004 (603) | 6,445 (95) |
| Italian 1600-1799 | 487,351 (1,715) | 30,993 (213) |

A `manifest-only-lazy-pages` book (#7343, `scripts/lib/lazy-pages.mjs`) holds its IIIF manifest and true page count and
**no page docs**; `materializePages()` creates them on a reader's first open, on hold release, on publishing or for an
archiver, and moves `pages_state` to `materialized`. `cli-ocr.mjs` read and apply both look pages up by id, so these
books cannot be read through the route without materializing them, which is a state change this test does not make.
**This result therefore speaks only for books with page records.** Those are mostly Internet Archive scans; the
manifest-only mass is e-rara and BSB (French: e-rara 2.6M, BSB 0.94M pages).

### Results (judged 2026-11-07; `run.mjs score`, and `run.mjs pooled` for two draws)

Second draws were made, from books not yet sampled, for French 1600-1799 and Spanish 1600-1799 (close on P), and
for French 1800-1929, whose two wrong-text pages were both the marker defect below. Spanish 1600-1799 had only 5 unsampled
books left. Spanish 1800-1929 had none (the first draw took every eligible book). Italian was not close in either
period, so it got no second draw.

**As the rule was committed** (every written page counts):

| cell | draws | drawn | written | judged | accepted | wrong text | P(acc≥0.8) | wrong-page | plants | decision |
|---|---:|---:|---:|---:|---:|---:|---:|---|---|---|
| French 1800-1929 | 2 | 60 | 32 | 32 | 28 | 2 (6.3%) | 0.815 | 4/4 | 4/4 | HOLD |
| French 1600-1799 | 2 | 60 | 29 | 29 | 26 | 0 | 0.875 | 4/4 | 4/4 | HOLD |
| Spanish 1800-1929 | 1 | 27 | 24 | 24 | 23 | 1 (4.2%) | 0.973 | 2/2 | none | HOLD |
| Spanish 1600-1799 | 2 | 35 | 30 | 30 | 27 | 1 (3.3%) | 0.895 | 4/4 | none | HOLD |
| Italian 1800-1929 | 1 | 30 | 21 | 21 | 18 | 3 (14%) | 0.667 | 2/2 | none | HOLD |
| Italian 1600-1799 | 1 | 30 | 19 | 19 | 16 | 1 (5.3%) | 0.587 | 2/2 | none | HOLD |

**The marker defect.** Six of the 226 agy replies stopped part-way through the page, opened a second `<<<BEGIN>>>`, and
answered `UNCHANGED`. `unwrapRead()` (scripts/lib/agy-cli.mjs) took that as a clean reply. The page, cut after a few
lines and with the markers in its text, passed every write guard. Three such pages were written: two in French
1800-1929 and one in Spanish 1800-1929 (that Spanish-catalogued book prints French). The judge marked all three wrong
text (O5 omission). They are the only wrong-text pages in those two cells. PR #8296 makes `unwrapRead` refuse such a
reply: cli-ocr re-reads the page once and apply refuses it if the reply is still bad. The second draw ran with that fix,
and it refused one more reply of this shape. The same scan found five live pages with the marker, written 24-28 October
by `agy-correct-lite-7558` and `paddle-zh-guarded-2026-10` (listed in #8296).

**Counting those reads as refused** (what the route does once #8296 is merged; reported beside the rule's figure, not
instead of it):

| cell | judged | accepted | wrong text | P(acc≥0.8) | would decide |
|---|---:|---:|---:|---:|---|
| French 1800-1929 | 30 | 28 | 0 | 0.962 | PASS |
| Spanish 1800-1929 | 23 | 23 | 0 | 0.995 | PASS |
| the other four | unchanged | | | | HOLD |

Defects per 1,000 words of the written pages (`defect-rates.json`):

| cell | words | wrong text | misleads | mean fidelity |
|---|---:|---:|---:|---:|
| French 1800-1929 | 9,776 | 0.31 | 0.61 | 4.56 |
| French 1600-1799 | 8,515 | 0 | 0.70 | 4.79 |
| Spanish 1800-1929 | 7,658 | 0.26 | 0 | 4.71 |
| Spanish 1600-1799 | 13,104 | 0.08 | 0.69 | 4.37 |
| Italian 1800-1929 | 7,335 | 2.45 | 0.27 | 4.57 |
| Italian 1600-1799 | 5,255 | 0.19 | 1.33 | 4.37 |

What the rejected pages show:
- **Italian 1800-1929** fails on numbers. Old-style figures are misread (1 read as 4 in a run of page references), and
  fractions are turned into other values (1/48 became 4⅛; a table of *braccia/oncie* measures was rewritten). The
  corrector does not catch the draft's numeral errors.
- **Italian 1600-1799, Spanish 1600-1799 and French 1600-1799** fail on the long s (*saremo* read as *faremo*;
  *lastò* as *faltò*; *asserentibus* as *afferentibus*). There are also one normalisation (*sua* for the printed
  *una*) and one word lost across a hyphenated line break (*gran-/dote* became *grande*).

### Why pages went unwritten (both draws, 242 drawn, 155 written)

| reason (cli-ocr apply's guards, dry run) | fr19 | fr17 | es19 | es17 | it19 | it17 |
|---|---:|---:|---:|---:|---:|---:|
| corrector tags the page handwritten or mixed (route is print only) | 11 | 18 | 0 | 0 | 1 | 2 |
| GPU draft under 30 word characters, or the read failed | 5 | 4 | 2 | 0 | 4 | 1 |
| diff-guard put-back not like-for-like, or spans a tag | 4 | 4 | 0 | 5 | 3 | 8 |
| letters outside the book's scripts | 3 | 3 | 1 | 0 | 0 | 0 |
| restarted read (two headers) or reply wrapper | 4 | 2 | 0 | 0 | 0 | 0 |
| corrector UNCHANGED on a headerless draft, or under 30% of words in the draft | 1 | 0 | 0 | 0 | 1 | 0 |
| **unwritten / drawn** | 28/60 | 31/60 | 3/27 | 5/35 | 9/30 | 11/30 |

Most unwritten French pages are ones the corrector tagged handwritten (29 of 59). These books have page records,
were catalogued as printed, and passed `manuscriptReason`, yet a sizeable share of their body pages appear to be
manuscript (letters, registers, notes bound in). Those pages were not checked by eye. If the tag is right, they belong
to a manuscript lane, not to this one.

### Cost and rate
- **GPU:** LightOnOCR-3-1B drafted 177 pages in 249 s of reading (2,555 pages/h; 421 s with vLLM start-up), 0 errors,
  5 drafts at the token cap. The second draw was 65 pages in a 226 s task, mostly start-up.
- **agy:** 233 calls for 226 reads (1.03 a read; a page that re-reads costs 2) and 155 written pages (**1.50 calls a
  written page**; 1.69 a judge-accepted page). A call takes about 10 s, so one pool reads about 350 pages/h at
  concurrency 1. Its 5-hour window used about 0.1% a call (2.9% for 28 calls on `.agy-milo`), about 960 calls a window.
  Its **weekly** bucket used about 0.03% a call (0.78% and 0.84% for 28 calls on two pools), roughly 3,300 calls a week
  a pool. **The weekly agy quota, not the GPU, is the limit.** These quota fractions come from two small samples,
  so read them to about ±30%.
- Claude (judge): 137 + 44 items through `judge.mjs`, Opus, `claude -p` on the subscription.

### What share of the unread pages this speaks for
The frame is books with page records. Pages owed in the frame, against all unread pages in the band
(*Where the pages are*):

| cell | owed in frame | all unread in band | share |
|---|---:|---:|---:|
| French 1800-1929 | 35,678 | 1,179,189 | 3.0% |
| French 1600-1799 | 43,693 | 2,665,819 | 1.6% |
| Spanish 1800-1929 | 7,463 | 11,877 | 63% |
| Spanish 1600-1799 | 14,223 | 51,027 | 28% |
| Italian 1800-1929 | 6,308 | 233,449 | 2.7% |
| Italian 1600-1799 | 11,644 | 518,344 | 2.2% |

French and Italian results say nothing yet about the e-rara/BSB manifest-only mass, which is about 96% of their unread
pages and is held as `manifest-only-lazy-pages`. Reading it needs `materializePages()` first, which changes the books' state.
These are different scans (e-rara and BSB IIIF, not IA), so a cell drawn from them after materializing a sample of
books would be the test that speaks for them.

### How the router's French evidence bears on this
`french-gpu-7263/print` (gpu-glm>agy-flash-low 38/38) and `french-lite/print` (agy@4 55/60) were measured on #7567
panel pages that already had a Flash-Lite read. Those pages were chosen for an engine comparison, not drawn from
unread books. Both say agy Flash-low is a strong French corrector when it gets a usable draft or read. This test
agrees: once the marker defect is out, it accepted 28/30 French 1800-1929 and 26/29 French 1600-1799 written pages,
with no wrong text. What the panel did not measure is the share of unread pages the route will write at all. Here
that share is about half (32/60 and 29/60), mostly because of the handwritten tag. It is the main cost of the route
in French and shows up only on a draw from the unread books themselves.

### Writes
138 judge-accepted pages (both draws) were written as first reads through `cli-ocr.mjs apply --diff-guard=gpu-draft`
(pipeline `gpu-agy-first-read-euro-6871`, a revision a page, only on pages with no text and no human edit). No hold
was released. Rejected and unwritten pages stay unread. 155 page verdicts are recorded through
`recordPageVerdicts()` under method `euro-gpu-agy-cell-6871`.
