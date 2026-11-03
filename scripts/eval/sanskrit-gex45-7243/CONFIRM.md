# Amendment 2 — the print confirmation run (#7243), preregistered 2026-11-03

PRIOR ART: `PREREG.md` (this directory; the 7243 test this run confirms, its scorer, references and gate) and
`scripts/eval/experiments/2026-10-24-sanskrit-gex45-vs-flash-7243.md`, whose decision asked for "a decision-grade
confirmation of Surya 2 on ≥ 50 more print books, the same references and gate, with a severity grader carrying planted
controls". This file is that run's preregistration. Written and committed before any engine read a test page, before any
reference was written, and before any stored read was opened.

## Question
On printed Devanagari pages from the hidden Sanskrit backlog that the 7243 test did not see, is Surya 2 on the GEX45
non-inferior to Flash? If yes, printed Devanagari routes to a Surya lane on the GEX45 GPU filler (Derek decides).

## Pages (`draw.mjs --pooled 300 --exclude candidates-observed.json --seed 72432`, `confirm-classify.py`)
- Population: `books` with `language` /sanskrit/i, `visible != true`, `pages_count > 0`, minus the 105 books drawn for
  7243: 10,560 books on 2026-11-03 (the 8,806 of 2026-10-24 plus a 2026-10-27 import).
- **Stub records are skipped.** The 2026-10-27 import created ~2,000 books with `pages_count` but no page records yet
  (825K of the 1.08M pages); no engine can read them. The pooled draw walks the page-weighted key order and skips a book
  with no page record (602 skipped to reach 300), so the draw is page-weighted over books that have page records.
- One pool (no source groups), books drawn without replacement with probability ∝ `pages_count`, one interior page each.
- Every candidate was looked at by eye in draw order (contact sheets of the middle third of the page; the full page
  where the class was unclear) and classed as printed Devanagari, manuscript/lithograph (any script; Śāradā and Newar
  were not separated, since this run is about print), or other. The first **50 printed Devanagari pages** in draw order
  are the test set (`pages-confirm.json`): candidates 0–240 were looked at; 50 print, 162 manuscript, 29 other.
- Rule for "printed Devanagari": type, not a hand or lithograph, with Devanagari the main script on the page. Two
  English-main pages with Devanagari quotations (#3, #234) are out; a Prakrit grammar page with English glosses that is
  mostly Devanagari (#69) is in. Hindi, Marathi and Prakrit pages are in (as in 7243).
- 20 of the 50 are marked hard by eye (two columns, small or worn type, indexes, Vedic accents, algebra).

## References (the 7243 method, `PREREG.md` § References, unchanged)
Two independent Opus reads per page from full-resolution tiles (`prep.py`), then an Opus adjudicator over the
differences. No reader or adjudicator sees any engine output. The 50 references' sha256 are committed
(`refs-manifest-confirm.json`) before any engine output is opened or scored. R1–R2 median CER is reported.

## Arms
| arm | what | how |
|---|---|---|
| **S** | Surya 2 on the GEX45 | `drive.sh S` in one gpu-queue task (the 7243 harness, `--gpu-memory-utilization 0.6`) |
| **F** | Flash, as the brief defines it | the stored `pages.ocr` text where its model is a Flash (not Flash-Lite) model; else agy `gemini-3.8-flash-low`, 1 pass, the 7243 prompt (`read.py` DEVA), via `scripts/eval/run-cli-arm.py --kind ocr` |
| FA | agy Flash on all 50 (sensitivity) | the agy reads of every page, including those with a stored Flash read |

Stored Flash-Lite reads exist on 11 pages; they are not Flash and are reported only as an aside, never in the gate.
The fed image is `archived_photo` capped at 2,400 px (`prep.py`), identical for S and the agy reads.

## Pass rule (print, n = 50; `score.mjs`, normaliser `deva-n@1`)
Surya 2 **passes** when all four hold against F:
1. **Non-inferior within the 7243 margin**: the upper end of the 95% bootstrap CI (10,000 resamples over pages = books,
   seed 7243) of the median paired difference CER_N(S) − CER_N(F) is ≤ **+2 points**.
2. **No rise in unread or catastrophic pages**: S's catastrophic pages (unread — empty, refused, filter-blocked,
   errored — or CER > 0.5, or a loop) ≤ F's. (7243 allowed F + 1; this run allows no rise, as the brief asks.)
3. Inserted passages (≥ 40 engine characters with no 8-gram in the reference): S's pages ≤ F's + 1 (as 7243).
4. **No rise in misleading pages by the judge**: S's pages graded 4 (text not on the page: recited, invented, another
   leaf) ≤ F's.
If 1–4 hold, the recommendation is to route printed Devanagari to Surya 2 on the GEX45 GPU filler; if any fails, print
stays on Flash and the write-up says which condition failed.

## Judge (severity, reported beside CER; only grade 4 enters the rule, as condition 4)
- One Opus grader per page, from the image tiles and the frozen reference, **blind to arm**: the outputs carry shuffled
  letters (key kept apart). Scale: `SEVERITY-GRADER.md` 0–4 + DNR (the #6740 scale), and, for each output, the
  `scripts/eval/spot-check/REVIEWER.md` severity of its worst error (serious / moderate / minor / none) and its
  `ocr_score` 1–5.
- **Planted controls on every page**, among the shuffled outputs: K0 = the reference itself (expected grade 0,
  severity none or minor); K1 = the reference with one planted error, alternating by page (seeded): a word replaced by
  another real word from the same page (expected grade ≥ 2) or one whole line deleted (expected grade 3). The grader's
  hit rate on K1 and its false-alarm rate on K0 are reported; if K1 is caught on fewer than 40 of 50 pages, the severity
  table is reported as unreliable and condition 4 falls back to the scorer's inserted-passage count.
- Reported per arm: counts per grade, share of pages at grade ≥ 2 or DNR, REVIEWER.md serious count, mean ocr_score.

## Out of scope
Manuscripts, Śāradā, and the throughput of a sustained lane (S's pages/h from this task is reported, not gated). No page
text is written to Mongo; stored reads are only read.

## Amendment 2a (2026-11-03, after scoring; a correction, disclosed)
The first scoring fed the 10 stored Flash reads to the scorer and the grader as `ocr.data` is stored. That text carries
the OCR apparatus (`<vocab>…</vocab>`, `<meta>…</meta>`, `<language>`, `<page-type>`, `<scan-quality>` …) that the
reader and every text surface remove content-and-all, so the vocab lists were scored as text and three were graded as
misleading. That was the scorer's error, not Flash's. F is now the stored read's **reader-visible text**:
`stripEditorialWrappers()` from `scripts/lib/strip-editorial-wrappers.mjs` (`confirm-stored.mjs`, field `text_visible`),
and those 10 pages were re-graded by fresh graders. Nothing else changed (same references, keys, controls and rule). The
agy and Surya outputs carry no such tags. Both scorings are kept: the first in `results-confirm-rawstored.json.gz`.
Under both scorings, all four conditions pass.
