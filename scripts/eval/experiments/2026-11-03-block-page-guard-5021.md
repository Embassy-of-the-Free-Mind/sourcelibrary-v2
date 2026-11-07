---
stage: translation
measure: [agreement]
languages: [la, de, it, fr, zh, el, bo, sa, ar, he]
scripts: [Latn, Hani, Grek, Tibt, Deva, Arab, Hebr]
canons: []
n_books: 340
n_pages: 2120
verdict: "A per-page wrong-leaf guard at write time (anchor copied from each page's own source, the call's absorption test, the single-page number vote) refuses 0 of 804 pages for the anchor on 200 fresh agy blocks of 4 (Latin, German, Italian, French, Chinese); the guard as a whole refuses 4 pages there, one block, and that block is a real overlap. On stored English it catches every 4- and 8-page alignment of Karl and Sakuntala by numbers and lengths alone, and every alignment of all four by-eye controls once anchors follow the text; on two draws of 560 pages of clean-by-write-time windows in seven script families it refuses 12, of which 4 are real wrong-leaf pages and 8 (0.7% of 1,120) are false."
status: adopted
decision: "Shipped in every multi-page path: claude-translate (agy and Opus blocks; the cli-translate-lane per_call rows and the siku lane run through it), cli-translate's folio-marked pairs, translate-worker, the chained and seam Batch lanes (via dropDriftedPages), and the multi-image OCR readers cli-ocr and claude-ocr. agy blocks answer in a validated JSON array by default (Derek 2026-11-03); the worker's block call is bound to a response schema. No lane moved to one page a call."
superseded_by: null
issue: [5021]
router_evidence: "none — a write-time guard's refusal rate, not a comparison of routes"
defect_rates: "none — the unit is a refused page, counted per call and per page"
---
## 2026-11-03 · A wrong-leaf guard at write time, in every multi-page call (#5021)

PRIOR ART: `scripts/lib/leaf-shift.mjs` (the number vote and the book-level absorption rule, reused here per call),
`scripts/lib/block-drift.mjs` `dropDriftedPages` (the hook every block parser already calls; the new checks run from
it), `scripts/audit/leaf-shift-gate-controls-5021.mjs` (the strict 2-page run gate's controls; kept, unchanged).

**Who it is for.** A reader of page n who gets fluent English for page n+1. Any call that carries more than one page
can do it, and the splitter only checks that each page HAS a section. Derek, 2026-11-03: prevent it, and keep
batching.

### The guard (`scripts/lib/block-page-guard.mjs`)

1. **Anchor** (prompted lanes). Each page's section opens with the first and last 12 characters of THAT page's source,
   copied. Each half is matched (NFKC, no marks, letters and digits only, edit distance ≤ 34% of its length) inside
   the head or tail half of the page's own source and of n±1 (with and without the page's metadata tags: an
   illegible leaf's only text is its metadata). A page refuses when a neighbour matches more halves than its own
   page, or nothing matches; a tie keeps it (running heads repeat). It reads characters, so it works where the number
   vote is silent (Han 91%, Tibetan 99% of pages).
2. **Absorption** (every lane). k = the call's median log(EN/SRC), else the book's stored median. A page whose English
   fits SRC(n)+SRC(n+1) and not SRC(n) (the #5021 thresholds) refuses with the rest of the call; a page whose English
   is under 15% of k's prediction, beside a neighbour that ran long, refuses from the page before it.
3. **Number vote** (every lane). The call's pages with the pages either side as context; a page voting only for
   the next or previous leaf with 2+ numbers (or one ≥ 30 with an own number missing) refuses.

A refused page is not written from the call: every caller already reads such pages again alone.

### Measured

**Fresh agy blocks, dry** (`scripts/eval/block-guard-5021/`, `claude-translate.mjs --cli=agy --per-call=4`,
candidate reads off, nothing applied): 200 blocks, one per book, 40 each in Latin, German, Italian, French, Chinese.
Scored with the final guard (`score.mjs`): **anchor refusals 0 of 804 pages.** Three matcher fixes came out of the
first scoring and are in the numbers: metadata tags folded out (`<scan-quality>`, `<vocab>` text stood in the
windows: 3 false refusals), a half may match the metadata of an illegible page (4), and the tail window is half
the page (an edition that ends each page on its variant apparatus: 2). Guard total: 4 pages, one Chinese block
(6a3c6050 pp.4-7): p.4's English carries p.5's opening ("When Xie Hui served as General Pacifying the Army…"), and
p.5 opens on the same sentence. A real overlap, caught by absorption. **Retry overhead: 4 single calls per 804 pages
(0.5%).**

**JSON reply** (`--reply=json`, 50 of the same blocks): 49 parsed, 1 refused on format and read again; anchor refused
1 page of 196 (Italian 695573c1 p.121, English 4,004 chars against a stored 2,799: not resolved); translations within
1% of the tag reply's length (median per language 0.98-1.01).

**Stored English** (`tests/fixtures/block-page-guard-5021.json`, `fixture-check.txt`). Four by-eye controls rebuilt as
they stood before containment: Karl and Sakuntala caught in every 4- and 8-page alignment without an anchor; Corpus
Medicorum 4/6 and 2/2; Postel 3/9 and 3/5 (its slide prints few numbers); with anchors that follow the text, every
alignment of all four at 2, 4 and 8 pages. Two synthetic one-leaf slides, Chinese and Tibetan: no number vote
(the gap), caught by the anchor, and by absorption when the anchors are right. Clean windows (4 pages, each page's
English written by a call of its own), 20 per family in Latin-script, Greek, Han, Tibetan, Devanagari, Arabic,
Hebrew, two draws. Draw 1 (an LCG seed, replaced for the repo's PRNG rule): 11 of 560 pages refused; 4 are real
(69b62fb0 pp.407-409, a Greek concordance whose English is the previous leaf's; 69b00f46 p.391, whose English is
p.392's Latin), read against the sources; 7 are false (a 307-character diagram page, an Easter table, a Hebrew page
whose English runs twice its source). Draw 2 (the committed fixture): 1 of 560, false (6990630b p.510, Zohar, two
shared numbers). **8 false refusals in 1,120 pages (0.7%)**, none in Tibetan, Arabic or Devanagari.

**translate-worker: 8-page block vs one page per Batch request** (`worker-cost.mjs`, translate-core prompts, 40
Batch-routed books, model-pricing.mjs, retries at 1.25% realtime): $0.00175 vs $0.00140 a page (3-flash-preview $0.00253
vs $0.00200; 3.1-flash-lite $0.00057 vs $0.00050). One page a Batch request with the neighbours as read-only context
is about 20% cheaper and cannot misassign a page; it gives up the worker's realtime turnaround. The worker wrote 375
pages in the last 14 days (cli-translate: 160K). It took the guard and the response schema in this PR and keeps its
8-page blocks; moving its books to one-page Batch requests is a separate change.

### Not measured here

The response-schema worker call and the guard on the Batch lanes and the multi-image OCR readers: no paid call was
made, and no OCR block was run. Each is checked on its next live run after merge (refusals are logged: worker stdout,
`calls.jsonl` `guard` lines in the CLI readers).
