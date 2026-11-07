---
stage: ocr
measure: [judged]
languages: [en]
scripts: [Latn]
canons: []
n_books: 10
n_pages: 10
verdict: "Of the GPU English print lane's 30,800 rejected reads, 1,395 were turned away for one engine note; 1,346 of the first 1,385 carried a single note as their last line. The lane now cuts a trailing or leading block of 'Note:' lines and judges the rest. 10 of 10 pages drawn by eye were usable (one per book, seeded), so 1,326 pages were written. The 6,999 transliteration-dense reads (202 books) are kept as candidate reads, not written. 20,294 other-script pages have their script recorded. 1,034 transient Wellcome fetch errors are re-queued once."
status: adopted
decision: "Applied 2026-10-31 through the lane's writer (revision rows reason ocr_gpu_print_6871, sweep_log action transcribed-rejudged, 354 books). A note that sits inside the read, or a page that describes its image, still rejects."
superseded_by: null
issue: [6871]
router_evidence: "none — no router cell changes. This only changes what the English 1800+ GPU lane does with reads it rejected."
defect_rates: "none — a 10-page by-eye usable/not check of one lane's guard change; no defect classes were counted per 1,000 words, and no route was compared"
---
## 2026-10-31 · What should the GPU English print lane do with the reads it rejected? (#6871)
<!-- PRIOR ART: 2026-10-29-print1800-gpu-engine-lanes-6871.md (the lane, its guards and the pilot by-eye check that added the commentary and transliteration guards). This entry measures the rejected reads those guards produced; it does not re-open the guards. -->

Data: gex45 `/root/jobs/gpu-print-6871` `rejected.jsonl` and `out/<bid>/<pn>.json`, read 2026-10-31 at about 19:30 UTC. Code: `scripts/lib/gpu-print-lane.mjs` (`stripEdgeNotes`, `detectScript`, `isTransientReadError`, `doneKeys`). The new subcommands are in `scripts/workers/gpu-print-lane.mjs`: `rejudge`, `keep-rejects`, `scripts` and `requeue-errors`.

### Per reason, before and after

| reason | rejected | now |
|---|---|---|
| engine_commentary | 1,395 | **1,326 written** (note cut). 42 still reject (the note sits inside the read, or the page describes its image), 11 left as textless (the note was the whole page), 8 reject as transliteration-dense, 8 got text from another lane first |
| transliteration_dense | 6,999 in 202 books | not written; **6,997 kept** as candidate reads in R2 (2 failed `textProblem`: duplicated reply); list with per-page permille in `scripts/eval/print1800-gpu-6871/translit-dense-2026-10-31.json` |
| other_script | 20,294 in 370 books (13,842 early stops) | not written; script recorded: one `sweep_log` row per book (`other-script-pages`) plus `other-script.jsonl`; never re-planned |
| read_error | 1,057 in 8 books | **1,034 re-queued once** (Wellcome IIIF 403/502/504, all served 200 on 2026-10-31); 19 iiif.archive.org 400 and 2 archive.org 404 are broken paths, left; 2 transient errors on a released book left for the pipeline |
| loop guards | 1,055 | unchanged |

Where the engine notes sat (first 1,385): 1,346 had one commentary line and it was the last line; 38 had it in the middle; 1 had two. None led the page.

### By eye: 10 pages, one per book, seeded draw (`sha256('eye6871:'+page_id)`) from the 1,325 that would write

Each page's text (with its note cut) was read against the page image. Verdict: **10 of 10 usable**.

| # | page | verdict |
|---|---|---|
| 1 | [Virgil, Aeneid 7–12 p.241](https://sourcelibrary.org/book/69924f32c8e06d213c5d3758/page/241) | usable: word for word, signature mark kept |
| 2 | [Colville, Universal theosophy p.95](https://sourcelibrary.org/book/6ab22de94ac37d55a212e360/page/95) | usable: word for word, italics kept |
| 3 | [Rhys Davids, Buddhist birth-stories p.61](https://sourcelibrary.org/book/6ab2412c87d2180b7f5de4ff/page/61) | usable: running-head numeral xlix and signature "e" dropped |
| 4 | [Eddy, Prose works p.845](https://sourcelibrary.org/book/6ab235cf4ac37d55a213cdbc/page/845) | usable: margin line numbers left out (correct for reading) |
| 5 | [Mental medicine p.64](https://sourcelibrary.org/book/6ab230e14ac37d55a2133b99/page/64) | usable: drop cap read as part of "CONSIDER" |
| 6 | [Euripides III (Way), title p.12](https://sourcelibrary.org/book/69937a27b0a84a57639677c3/page/12) | usable: title page complete; owner's signature not read |
| 7 | [The Mabinogion p.31](https://sourcelibrary.org/book/699249c0a2d53df4853bfb8e/page/31) | usable: word for word, pencil "Notes 46 - 51" kept |
| 8 | [James, The Meaning of Truth p.225](https://sourcelibrary.org/book/69be9a3fc4b605eb19040718/page/225) | usable: π stays in LaTeX form (`$\pi$`) |
| 9 | [History of the Copts p.231](https://sourcelibrary.org/book/6992543a59cdabeb78f1ceea/page/231) | usable: side-note "Melkites and Jacobites" moved to the foot; italics lost |
| 10 | [Carus, The gospel of Buddha p.137](https://sourcelibrary.org/book/6ab2456387d2180b7f5e6e86/page/137) | usable: verse numbers kept inline |

### Other-script pages by script (pages, from `detectScript`, the script with the most letters)

Greek 9,467 · Devanagari 4,804 · Han 1,822 · Hebrew 1,444 · Arabic 1,077 · Cyrillic 608 · Tamil 404 · Tibetan 180 · Gurmukhi 172 · Gujarati 91 · Hangul 56 · Ethiopic 44 · Bengali 43 · Syriac 39 · Georgian 23 · Malayalam 8 · Telugu 6 · Thai 2 · Armenian 2 · Japanese 1 · Kannada 1.

These are pages in books catalogued English. Most hold a quoted span in another script, not a whole page in it; `latin` in `other-script.jsonl` gives the Latin-letter count beside the other script, but on the 13,842 early stops the read is cut at 40 letters. When the lane releases a book it placed on hold, the pipeline reads these pages with Flash-Lite as English print. A book under a scans-only hold keeps them unread until a language route takes them.

### Transliteration-dense pages: permille distribution

p25 21 ‰, median 32 ‰, p75 53 ‰, p90 84 ‰; 3,250 pages at 15–30 ‰, 2,384 at 30–60, 816 at 60–100, 549 above 100. The largest books are the Divyāvadāna (692 pages, median 61 ‰), two PTS Pali-English dictionaries (496 and 431), and the Atharva-Veda Saṃhitā vol. I (443). The kept read is the draft for a correction pass (#7567 arm c, #7853 routing); none is written as is.
