---
stage: translation
measure: [agreement]
languages: [la, en]
scripts: [Latn]
canons: []
n_books: 600
n_pages: 0
verdict: "Cicero, De natura deorum (Venice 1546) served English one leaf ahead of its Latin on 17 pages in three translation blocks. The 'three pages ahead' in the report is a one-slot slip across leaves that never got OCR: pp.57-58 and 61-63 are empty, so p.56's English was p.59's leaf. The leaf-shift classifier took page_number ±1 as the neighbours, so an empty neighbour could never get the vote, and the shape was invisible. With neighbours taken as the nearest page that carries text, the classifier finds the Cicero block. On a seeded draw of 600 live translated books (seed 8464) the number runs are identical under both rules (17 flagged, 4 tier A), nothing is lost, and one new name run appears (Claudian, Loeb vol.1, pp.94-95, across an empty p.96). That flag is real when the text is read."
status: adopted
supersedes: []
decision: "scripts/lib/leaf-shift.mjs classifyBook skips pages with neither OCR nor English, and runs are adjacent by position, not page_number (audit and write-time gate alike). The 17 Cicero pages were re-translated one page per call with wrong-leaf-fix-5021.mjs (agy gemini-3.8-flash-low; old English in page_revisions)."
superseded_by: null
issue: [8464, 5021]
router_evidence: "none — a detector's neighbour rule and a repair on one book, not a comparison of routes"
defect_rates: "none — the unit is a page on the wrong leaf"
---
## 2026-11-10 · English one leaf ahead across untranscribed leaves (#8464)

PRIOR ART: `scripts/audit/translation-leaf-shift.mjs` and `scripts/lib/leaf-shift.mjs` (#5021). The classifier is
changed here, not rebuilt. The repair reuses `scripts/maintenance/wrong-leaf-fix-5021.mjs enqueue` + `run`.

**Who it is for.** A member reading Cicero on p.56 got fluent English for p.59. Nothing on screen said so.

### Cause (book 6a06d4e89a48d513999643b4)

- No OCR was ever written for pp.51-52, 57-58 and 61-63 (no `ocr` revision rows). They are not blank leaves: the
  printed page numbers jump (p.60 = printed 25, p.64 = printed 27). The book was translated on 2026-06-06 by the
  block lane (prompt v11, gemini-3.1-flash-lite), and the translator saw only the leaves with text.
- In the block written at 08:51:40 the English slipped one slot from p.55 on: EN(55) = OCR(56), EN(56) = OCR(59),
  EN(59) = OCR(60), EN(60) = OCR(64), EN(64) = OCR(65). OCR(55) had no English anywhere. Counted in page numbers
  that is +1, +3, +1, +4: the issue's "three pages ahead".
- `page_revisions` for the book, by source: `ai` translation 2026-11-03 (p.54, already re-translated under #5021),
  cleanups (`cleanup-a2-5700`, `cleanup-markup-5700`, `longs-pass-5924`, `strip-proquest-6056`), and one `reocr_cli`.
  None of them moved text. The page order was not shuffled and nothing was split after translation. This is the
  #5021 block slip.
- The same shape, with no OCR gaps, sits in two more blocks of the same volume: pp.311-315 (De legibus I: 311 carries
  its own leaf and 312's; 312-314 carry their successors) and pp.342-348 (342 carries its own and 343's; 343-347
  carry their successors). The old name signal had already reported 343-347. pp.166/167 show a boundary drift (p.166's
  English runs into p.167's leaf).

### Why the detector missed it

`classifyBook` voted a page's English against `byPn.get(page_number ± 1)`. For p.56 that is p.57, an empty page, so
OCR(59)'s names could never vote `next`, and the empty rows broke runs as well. Now pages with neither OCR nor English
are dropped before classification. Neighbours are the adjacent remaining rows (`pos`), and strict, gappy and
absorption adjacency read `pos`. A page that has OCR but no English is still a neighbour. Unit case:
`tests/unit/leaf-shift-gappy-runs.test.ts` "#8464".

- Cicero, before: no run near p.56. After: a name run `next` 56-64 (3 voting pages), beside the 343-347 run already
  known.
- **Rate, seeded draw of 600 of 25,013 live translated books (seed 8464), old vs new classifier on identical text:**
  number runs 17 vs 17 books (tier A 4 vs 4), zero runs lost. Name runs outside number runs: 13 vs 13 books, one run
  added. The added run is Claudian, *Complete Works* vol.1 (Loeb, 69aec132b87be1eef391d487) pp.94-95: p.96 is empty,
  and EN(95) = OCR(97) word for word. Read in the text, not opened in a scan. It is not repaired here.
- Coverage is the same as #5021: Latin prose prints few body numbers, so this book is found by names alone, and a
  name run is reported, not flagged. No flag still means NOT checked, not aligned.

### Repair

17 pages (55, 56, 59, 60, 64, 166, 167, 311-314, 342-347) were re-translated one page per call from their own OCR,
through `wrong-leaf-fix-5021.mjs` (`JOB_NAME=fix-8464`; book route latin-cli-agy4 → agy gemini-3.8-flash-low). The
old English was snapshotted to `page_revisions` by translate-core. Before the apply, every new read was checked
against its own OCR (opening and closing words, names: own > neighbours on all 17). After the apply, the slot scan
and the classifier find no run in the book. Ledger: `$JOB_SCRATCH/fix8464/ledger.jsonl` (spare-8464).

Not done: the other books in the report (Plato *Laws* p56, Nagarjuna scan 264, Cicero *De legibus* p42) were not
identified from titles alone. A library-wide re-run of the audit under the new neighbour rule was not done either.
