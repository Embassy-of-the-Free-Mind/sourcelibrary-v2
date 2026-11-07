---
stage: ocr
measure: judged
languages: [la]
scripts: [Latn]
canons: []
n_books: 54
n_pages: 24144
verdict: "From stored text alone, two defect classes can be found and fixed: long s read as f (8.9% of pages; 14.1% on flash-lite books, 4.1% on flash-preview) and facing-page strips filed as side-notes (2.0% flagged, 8 of 14 confirmed by eye, and a floor). Truncation, column read-across and empty-page detectors all failed the by-eye check (0/4, 0/4, 1/4). The re-read class (wrong leaf, omitted passages, a lost column) cannot be seen in the text at all. 25 pages spread through the book predict the whole book (Spearman ρ 0.76–0.82); the first 25 pages do not (ρ 0.25–0.30), because only 55% of them are text."
status: informational
decision: "Decide per book from 25 pages spread evenly through the body, never the first 25. A text-only repair applies in place for long s (lite-read books) and for margin strips. It is not applied here, because an OCR write triggers gap-fill retranslation. Re-reading a whole book needs an image check on the 25 spread pages, since no text signal sees it. The GPU arm (does 25 pages predict 'can go to GPU OCR'?) is queued as a follow-up (#5924)."
superseded_by: null
issue: [5924]
---
## 2026-10-22 · Can we fix the Latin OCR we already have, programmatically? Do 25 pages decide the book? (#5924)
<!-- PRIOR ART: 2026-10-18-latin-gex45-bakeoff-5924.md (the 99 references and flash-lite's reads of them, used here as the natural long-s control); 2026-10-06-latin-print-r4-by-book-5924.md; scripts/lib/ocr-loop-guard.mjs loopVerdict (the loop class, unchanged). -->

**Question.** Derek, 2026-10-22: "can we fix the ocr we have programmatically? … if we do the first 25 pages … maybe
we have enough info on whether we do the whole." PR #6912 found that lite's character reading is about 99% once ſ→f
is forgiven, and that the remaining errors are page-level and depend on format. This census asks how common each
defect is, which of them a text edit fixes, and whether 25 pages are enough to decide a book. Cost: $0. No Gemini
calls, Opus only through subagents, and no writes to `pages` or `books`.

**Frame and draw** (`draw.mjs`).
- The frame is Latin books with `pages_ocr` ≥ 100, a first year 1450–1800 in `published`, and no `duplicate_of`. It
  includes hidden books: 3,923 in all (1450–99: 775, 1500s: 1,560, 1600s: 1,130, 1700s: 458).
- 60 books were drawn in Mulberry32(5924) order into century × engine cells, where the engine is the book's majority
  `ocr.model`.
- No book in the first 901 checked was read mainly by an engine other than flash-lite or flash-preview, so the
  "other" cell is empty. (`claude-opus-5-5` read 61 pages; one book had a few `gemini-2.5-flash` pages.)
- The Opus format readers found **6 of the 60 books are manuscripts** catalogued as print. They were excluded, which
  leaves **54 books and 24,144 pages with stored OCR**. This also says something about the catalogue: about 1 in 10
  "Latin printed" books in this frame is hand-written.

**Detectors** (`detectors.mjs`, gated in `controls.mjs`). Each detector had to fire on ≥ 80% of planted cases and on
≤ 5% of clean pages before it was counted. The ſ-lexicon and the character LM were learned from 2,043 flash pages
that keep ſ, taken from 320 Latin books outside the draw. 501 pages from held-out books served as the clean set.

| class | route | planted → fired | clean → fired | by eye, flagged pages confirmed |
|---|---|---|---|---|
| long s as f | FIX in text | ſ→f planted 467/470; lite on the refs where it wrote f 65/67 | 8/470; references as printed 0/99 | **10/10** |
| facing-page strip (margin / column-break / in-body block) | FIX in text | line-starts 55/59, in-body 74/85 (line-ends 22/59: a known gap) | 2/196; real side-notes 2/61 | **8/14** |
| loop (production `loopVerdict` + unique lines) | re-read* | 421/470 | 0/470 | **3/4** |
| column read-across (hyphen test) | re-read | 92/101 | 1/101 | 0/4 |
| truncation (length vs neighbours) | re-read | 107/114 | 1/114 | 0/4 |
| empty / refusal | re-read | 113/114 | 0/470 | 1/4 |

\* The brief called a loop fixable by collapsing it. By eye, 3 of the 4 real loops had also lost the text after the
loop, so the census routes loops to re-read. The last three detectors passed their planted controls and failed on
real pages: short pages are short by design (diagrams, inserts, chapter ends), and nothing they flagged was a
read-across. They are reported and **not counted**. Two shapes tried for bleed, duplicated neighbour lines and line-
start fragments, passed their planted controls but were 1 of 5 by eye (index entries, figure keys). They are kept
as diagnostics only. The margin-strip shape that replaced them was found by the round-1 by-eye check. Round 2 was
10 new flagged pages and confirmed 4 of them.

**Prevalence (pooled over pages; `results/report.json` has the book-mean view).** "Text repair fixes" is the share of
flagged pages whose every flag is a FIX class.

| cell | books | pages | long-s % | bleed % | loop % | any % | text repair fixes |
|---|---|---|---|---|---|---|---|
| **all** | 54 | 24,144 | 8.91 | 2.03 | 0.10 | 10.67 | 99.1% |
| engine: flash-lite | 28 | 11,525 | 14.13 | 3.05 | 0.16 | 16.69 | 99.0% |
| engine: flash-preview | 26 | 12,619 | 4.14 | 1.10 | 0.04 | 5.18 | 99.2% |
| 1450–99 | 12 | 3,871 | 7.41 | 1.42 | 0.28 | 9.04 | 96.9% |
| 1500s | 17 | 8,583 | 12.96 | 0.75 | 0.02 | 13.46 | 99.8% |
| 1600s | 16 | 7,395 | 5.73 | 4.96 | 0.11 | 9.97 | 98.9% |
| 1700s | 9 | 4,295 | 7.66 | 0.09 | 0.07 | 7.80 | 99.1% |
| roman | 36 | 16,887 | 10.68 | 2.68 | 0.08 | 12.92 | 99.4% |
| italic | 8 | 3,945 | 2.81 | 0.53 | 0 | 3.35 | 100% |
| gothic | 10 | 3,312 | 7.16 | 0.48 | 0.33 | 7.94 | 95.8% |
| two columns | 8 | 6,220 | 20.42 | 0.76 | 0.19 | 20.96 | 99.1% |
| side-notes printed | 9 | 7,023 | 15.46 | 1.24 | 0.04 | 16.37 | 99.7% |
| Greek printed | 10 | 3,181 | 5.60 | 4.90 | 0 | 9.68 | 100% |
| facing strip visible in image | 23 | 9,629 | — | 2.94 | — | 9.33 | — |

How to read the table:
- The pooled long-s rate is concentrated. One two-column lite book has 840 flagged pages. The book-mean long-s rate
  is 6.5%.
- Long s is a **floor**. The page rule needs ≥ 3 hits and ≥ 1% of tokens, and the lexicon recovers 54% of planted
  ſ→f tokens: `fit`/`sit` and `fine`/`sine` are left alone by design. 4 of the 24 unflagged pages checked by eye had
  a few f-for-ſ.
- Bleed is also a floor. The random unflagged draw found it on 2 of 10 pages, so it is more common than 2%.

**What the eye saw that no text signal can** (50 pages, 46 of them printed; 8 needed a re-read). Only 2 of the 8 were
loops the detector flagged. The rest were the wrong leaf's text, passages omitted mid-page, a lost final paragraph or
column, and side-notes dropped or merged into the body. **The random unflagged draw: 0/10 needed a re-read** (Wilson
95% 0–28%). So the "99% fixable in text" figure covers only the defects that text can see. Re-read defects exist, and
they are invisible from the text.

**The 25-page question** (`analyze.mjs`). Per book, the defect rate in (a) the first 25 OCR'd pages, (b) 25 pages
evenly spaced, (c) 25 random pages (mean of 200 draws), each against (d) the whole book.

| metric | books with any | ρ first 25 | ρ 25 spread | ρ random 25 | MAE first / spread (pts) |
|---|---|---|---|---|---|
| long s | 49 | 0.30 | **0.76** | 0.72 | 6.7 / 2.8 |
| bleed | 28 | 0.64 | **0.67** | 0.63 | 2.1 / 0.8 |
| fixable (any FIX) | 52 | 0.29 | **0.82** | 0.74 | 7.7 / 3.1 |
| any defect | 53 | 0.25 | **0.81** | 0.73 | 7.7 / 3.1 |

| rule (54 books) | whole-book yes | first 25: agree / miss / false alarm | 25 spread: agree / miss / false alarm |
|---|---|---|---|
| long-s repair if ≥ 5% of pages | 23 | 32 / 14 / 8 | **44 / 7 / 3** |
| long-s repair if ≥ 20% of pages | 2 | 50 / 1 / 3 | 52 / 0 / 2 |
| bleed clean-up if ≥ 2% of pages | 7 | 46 / 2 / 6 | **51 / 0 / 3** |
| any action if ≥ 10% of pages | 12 | 41 / 7 / 6 | **48 / 3 / 3** |
| re-read if ≥ 10% of pages (text-detectable) | 0 | 54 / 0 / 0 | 54 / 0 / 0 |

The first 25 pages are front matter. Only 55% of them are text pages, against 90% of the whole book: they are blank
leaves, prefaces, dedications, title pages and indexes. 25 spread pages do slightly better than 25 random ones. The
re-read rule cannot be decided from text: no book reaches 10%, because text cannot see the re-read class.

**Recommended rule.**
1. Sample 25 pages spread evenly through the body. Never use the first 25.
2. **Repair in place** for long s on flash-lite books that print ſ, where ≥ 5% of the spread sample fires (23 of the 54 books by
   their whole-book rate), and strip margin strips where they fire. Both are lexicon or deletion edits on stored text.
3. **Re-read the whole book** only on an image check of the same 25 pages: a by-eye or model reader asking about the
   wrong leaf, omissions and lost columns. Text gives no signal for it.
4. **Leave** flash-preview books below threshold (5% of pages defective, mostly long s).

Applying any repair is a separate decision. Rewriting `ocr.data` triggers gap-fill retranslation (lesson
ocr-apply-triggers-gapfill). A long-s edit changes no meaning, so it should go through a path that does not mark the
translation stale. That path does not exist yet.

**Not done here.**
- No repair was applied, and no write was made to any store.
- The sibling longs-pass-5924 lexicon was not merged when this ran, so this job built its own from flash text.
- Derek's added scope, "do 25 pages predict GPU-OCR suitability", is planned in `gpu-plan.json`: 25 spread pages × 54
  books, plus 20 whole books stratified by format. It is handed to a gex45-capable box (see #5924).

Files: `scripts/eval/latin-repair-census-5924/` (draw, corpus, detectors, controls, census, leaves, analyze,
gpu-plan; `results/` holds counts, labels and verdict booleans only, with no page text).
