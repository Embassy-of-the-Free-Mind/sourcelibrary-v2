---
stage: translation
measure: [judged]
languages: [la, de, el, he, zh, ar, fr, it, en]
scripts: [Latn, Grek, Hebr, Hani, Arab]
canons: []
n_books: 44
n_pages: 44
verdict: "Round 2 adds a check of each page's OCR against its neighbours' OCR before the page is re-translated. The gate still FAILS: duplicate gone 29/30 (bar 30/30), usable 24/30 [0.63–0.90] (bar 28/30), own leaf 28/30, and all 4 controls caught. Of the 6 failures, 3 come from the page's own OCR and 3 are engine errors (Latin, Greek, Chinese). They are spread over four scripts, so no single-script slice can be left out to pass. The OCR screen catches both OCR failures from the pilot, but the agy re-read it triggers was refused on 6 of the 8 flagged gate pages. The waves are not run."
status: undecided
feeds: repair
decision: "Waves stay stopped. The 32 re-translated gate pages are kept, because each replaced English that carried another page's text. Revert: leak-repair-5026-r2-gate and -r2-gate-ocr. Pilot plus round 2: usable 51/60. The faults are OCR on 5/60 pages and engine on 4/60. English books (1,308 pairs in 481 books) have no own-leaf route under the #5154 policy."
superseded_by: null
issue: [5026, 5274, 4958, 5154]
router_evidence: "none — a containment repair on one fixed route (agy gemini-3.8-flash-low, own-leaf prompt, the #5274 route). The 30-page post-check is in scripts/eval/results/leak-repair-5026/r2-post-score.json"
defect_rates: "none — the verdicts are duplicate gone, leaf identity and usable yes/no per page, not defects per 1,000 words"
---
## 2026-11-08 · Leak repair round 2: OCR-neighbour screen, then re-gate (#5026)

PRIOR ART:
- `2026-11-08-leak-repair-5026.md`: the pilot. Its gate failed on the page's own OCR (Hebrew p.494, Chinese show-through), and it named an OCR check against the neighbours as next step 1. This round adds that check and runs the gate again.
- `scripts/eval/leak-repair-5026/pair-judge.mjs` and `scripts/maintenance/wrong-leaf-fix-5021.mjs --issue=5026`: the same runner and judge as the pilot, extended.

**Question.** If each page's OCR is checked against its neighbours' OCR first, and pages whose OCR holds a neighbour's text are re-read from the image, does the own-leaf repair pass the gate? The gate: duplicate gone 30/30 and usable ≥ 28/30.

### 1. The OCR-neighbour screen

`scripts/eval/leak-repair-5026/ocr-neighbour.mjs`. Tokens are Han or kana characters, otherwise words (combining marks kept; Latin, Greek, Hebrew and Arabic marks folded). It builds 4-token shingles that occur once on page n, and finds the longest covered run against page n−1 and page n+1, allowing gaps of up to 3. A page is flagged `ocr_dup` when that run is at least 20 words or 12 CJK characters.

| set | pages | flagged |
|---|---|---|
| the pilot's two known OCR failures | 2 | 2 (Hebrew run 269 against p.493; Chinese run 15 against p.8) |
| repair frame | 10,457 | 336 (3.2%) |
| random translated pages | 2,385 | 128. 94 are Tibetan (formulaic text), 34 are not (1.4%) |

Many of the 34 random hits are really repeated: duplicate scans (share about 0.99) and Pali refrains. So the screen routes a page to an image re-read. It is not used as a leak verdict.

In the runner (`P5026` in `doBook`), each page's OCR is screened live. A flagged page gets an OCR re-read through `cli-ocr` with all its guards on, and that re-read must be written in this run. The page is then screened again. If it still holds the neighbour's text, it ends as `ocr-neighbour-persists` and is not translated. If the re-read is refused, it ends as `ocr-refused`, with the reason.

### 2. Gate run (44 books, one page each)

Run id `leak-repair-5026-r2-gate` (OCR re-reads: `leak-repair-5026-r2-gate-ocr`). 8 OCR-flagged pages were picked on purpose.

| outcome | pages |
|---|---|
| re-translated | 32 |
| OCR re-read refused: Flash-Lite draft under the 40% floor | 5 |
| OCR re-read refused on an OCR-flagged page (40% floor, or handwritten/mixed script under `--print-only`) | 6 of 8 |
| re-read still holds the neighbour's passage (`ocr-neighbour-persists`) | 1 of 8 |

Only 1 of the 8 OCR-flagged pages reached re-translation. Under its guards, the screen's remedy (an agy image re-read) mostly refuses. Those pages keep their stored English, and that English is a known leak. A second batch of 12 books was not run, because the only agy pool with a login (`.agy-james`) was taken by another job.

### 3. Post-check (FAIL)

30 re-translated pages, one per book, from books not used in the pilot's post-check. A blind sealed `claude -p --model opus` judge read each page against its image and the neighbour its duplicate came from. The controls were rebuilt:
- A made duplicate is planted only from a neighbour with real English: a body of at least 800 characters, and no unclear, illegible or faded markers. In the pilot, the Q24 control was junk.
- A stored-leak control is taken from a pair judged a real duplicate in the spot check. It must be the page found wrong, unchanged since then, and the control asks about that page. In the pilot, Q08 asked about the wrong page.

| measure | result | gate |
|---|---|---|
| duplicate gone | 29/30 | 30/30 ✗ |
| usable | 24/30 [0.63–0.90] | ≥ 28/30 ✗ |
| renders its own leaf | 28/30 | |
| controls caught | 4/4 (2 made duplicates, 2 stored leaks) | all |

The six failures:
- **OCR, 3.** Q04, a Hebrew cursive manuscript, p.1: the OCR invented Syriac. Q29, Reg.gr.80, p.141: the OCR wrote Maximus "from memory". Q20, Latin, 6a0850d3…, p.38: the OCR read the edge of the facing p.37 as a margin, so the duplicate stays.
- **Engine, 3.** Q13, Latin, 6952d19c…, p.92: the closing sentence is left out. Q33, Greek, 69b2f437…, p.720: a major mistranslation. Q27, Chinese, 6a1d81b4…, p.308: three major mistranslations in a dense commentary.

The failures fall on four scripts, so leaving out one slice would not pass the gate. **Pilot and round 2 together:** usable 51/60. The faults are OCR on 5/60 and engine on 4/60. Before the repair, every one of these pages served another page's English.

**Contained** (by eye, in the same run): the books 69c1bf28 (Kabbalistic text), 6953ae81 (PGM) and 6a2032bf (Qur'an juz, Or.7092) are held with `leak-contained-5026`. Reg.gr.80 (69a5e3d8) was already held (`ocr-unsettled-6420`). The withheld pages are 69c1bf28 p.1, 69a5e3d8 p.141, 6953ae81 p.116 (the Q15 control) and 6a2032bf p.8 (the Q18 control). Q20 is not contained: the bulk of that page is its own leaf, like the pilot's Chinese show-through.

The 30 verdicts are recorded in `book_checks` under method `leak-repair-5026`, round `post`.

### 4. English books

There are 1,308 flagged pairs in 481 books (`en-books-list.jsonl.gz`): 109 books (311 pairs) printed before 1820, and 372 books (997 pairs) from 1820 on or undated. **No own-leaf modernisation route exists.** The #5154 policy has every writer refuse English books (`sameLanguageReason` in translate-core; `cli-translate` skips them). The reader always shows the transcription for these books (`TranslationEditor.tsx:666`), so the leaked modernisation sits one toggle away.

### Reading

The screen finds the OCR fault it was built for. But the remedy, an agy image re-read under the existing guards, refuses most of the pages it is sent. Meanwhile, the post-check found a second set of OCR faults (invented script, text written "from memory", a facing-page margin) that do not show up as a match with a neighbour. The engine errors (about 4/60) are what Flash-low does on hard pages, and they spread across scripts. The own-leaf route still removes the duplicate (58/60 over both rounds), so the gate is failing on page quality the repair inherits, not on the leak itself.

**Not done.** The waves (about 9,700 queued pages in 3,355 books), because the gate failed. The second gate batch, because the pool was busy. English books, which have no route.

Quota: about 50 agy Flash-low calls on `.agy-james` (32 translations and 13 OCR re-reads, some retried) and 34 sealed Opus calls on the subscription. No paid API was used.

Results: `scripts/eval/results/leak-repair-5026/r2-*` and `en-books-list.jsonl.gz`.
