---
stage: ocr
measure: [judged_vs_reference, judged]
languages: [lzh]
scripts: [Hani]
canons: []
n_books: 781
n_pages: 1568108
verdict: "A text-only rule (strict loop screen or repeated-line run, AND a run/duplicate-line/low-diversity/table-title shape) flags 136 of 136 known invented Paddle table pages and 4,379 of 1,568,108 Paddle-written pages (0.28%). As a backup reader, Opus by image over-writes printed characters 39 times where Paddle does 145 (19 Kanripo-aligned pages) at equal CER; Gemini 3.1 Pro on agy is slower, emptier and worse ordered."
status: undecided
decision: null
superseded_by: null
issue: [6388, 5600, 5660]
---
## 2026-10-11 · Paddle Chinese table and diagram pages: can a text rule find them, and which backup reader should read them? (#6388)

PRIOR ART: `2026-10-10-paddle-zh-random-qa-6388.md` (random-sample QA, 0/59 invented; its Opus/agy CLI readers and
Kanripo leaf rule are reused here), the job paddle-flagged-6388 comment on #6388 (Opus layout + verdict on 495
strict-flagged pages: invented 37% on tables vs 3.6% on prose; the labels this entry scores against),
`scripts/lib/first-ocr-guard.mjs` (the strict loop screen, the detector's gate) and the paddle-skqs-rest-6388
title-exclusion rule (a per-WORK list). None of them is a per-PAGE table detector, and none compared backup readers
on table pages. Code and data: `scripts/eval/paddle-table-6388/` (README lists the order). The detector:
`scripts/lib/paddle-table-detect.mjs`, test `tests/unit/paddle-table-detect.test.ts`. **Not wired into the lane.**
Nothing was written to `pages` or `books`.

### Part A: the detector (scripts only, no model calls)

**Labels.** 621 judged page texts, 611 unique pages in 353 books:
- 495 strict-flagged pages with Opus's layout call and verdict (paddle-flagged-6388): 186 table, 309 prose, 80 invented.
- 66 contained pages (the Paddle text from their `page_revisions` snapshot, reason `contain_paddle_zh_6388`). 10 of
  them are also among the 495. The other 56 are counted as invented, and 54 of those are 洪範皇極內篇 charts.
- 60 qa3 random-sample pages: 0 invented, no layout call.

**Positives: 136 unique invented pages** (125 table or diagram, 11 prose-shaped dictionary/ditto pages).
**Population: every page whose served `ocr.source` is `paddle`:** 1,568,108 pages in 10,985 books (#5600: 1,033,868;
#5660: 447,245; #6388: 86,995), read once from Mongo with a projection.

**Signals, one by one** (recall over the 136 invented and the 242 table pages; precision inside the 495):

| signal | invented recall | table recall | invented / table share of what it flags in the 495 | qa3 flagged | population flagged |
|---|---|---|---|---|---|
| Paddle layout: `tables_flattened > 0` | 0/136 | 0/242 | none flagged | 0/60 | 6,946 |
| Paddle layout: `img_dropped > 0` | 0/136 | 0/242 | none flagged | 0/60 | 174 |
| strict screen (`local/line/exact_loop`, run > 40) | 134/136 | 240/242 | 16% / 38% | 0/60 | 4,857 |
| `repeated_line` (first-ocr-guard) | 88/136 | 119/242 | 46% / 85% | 4/60 | 85,684 |
| longest one-character run ≥ 4 | 106/136 | 127/242 | 56% / 76% | 1/60 | 22,917 |
| any duplicated line (≥ 2 Han) | 101/136 | 151/242 | 41% / 81% | 2/60 | 88,264 |
| distinct / total Han < 0.30 | 96/136 | 141/242 | 49% / 97% | 0/60 | 12,960 |
| share of lines ≤ 2 Han ≥ 0.4 | 40/136 | 99/242 | 28% / 81% | 10/60 | 202,207 |
| line-length CV ≥ 0.8 | 30/136 | 60/242 | 25% / 56% | 13/60 | 261,344 |
| work-title prior (三才圖會, 武備志, 洪範皇極, 易學象數論, 曆/歷/算, 圖說 …) | 117/136 | 165/242 | 50% / 90% | 1/60 | 41,459 |

- **Paddle's own layout output is no signal.** Paddle-VL wrote no `<table>` and no `<img>` on any of the 56 contained
  chart pages. Where it did write a table (6,946 pages, all #5600), none was judged invented or table-shaped.
- **The strict screen already catches the loops.** It is the obvious gate. The two invented pages it missed are
  洪範皇極內篇 vol 4 pp. 43 and 72 (contained). Both trip `repeated_line` with a run of 8–10 and a duplicated line.

**The rule (S4), `paddleTableRisk()`:** flag = **gate AND shape**.
- **gate** = the strict screen, OR (`repeated_line` with a run ≥ 5 and a duplicated line).
- **shape** = a run ≥ 4, OR any duplicated line, OR distinct/total < 0.30, OR a table-title match.

| rule | invented recall (Wilson 95%) | flagged within the 495 | invented share | table share | qa3 | **all Paddle pages** |
|---|---|---|---|---|---|---|
| strict alone | 134/136, 98.5% (95–100) | 495 | 16% | 38% | 0/60 | 4,857 |
| gate alone (T1) | 136/136 (97–100) | 495 | 16% | 38% | 0/60 | 5,884 |
| **gate AND shape (S4, shipped)** | **136/136 (97–100)** | **209** | **38%** | **73%** | **0/60** | **4,379 (0.28%)** |
| strict AND (run ≥ 4, dup, distinct < .3) (S1, no title, no repeated_line) | 133/136, 97.8% (94–99) | 188 | 42% | 75% | 0/60 | 3,330 |

- **By run (S4): #5600: 4,004; #5660: 191; #6388: 184.** In 781 books. That is the backup lane.
- **Two works hold 54% of it:** 御定子史精華 (1,212, the 丨 ditto runs) and 御製增訂清文鑑 (1,135, a Manchu–Chinese
  dictionary). Then come 易通變 192, 春秋大事表 183, 御製歷象考成後編 147, 三才圖會 94, 洪範皇極內篇 68 and 歷算全書 64.
- **What S4 drops from the 495:** 286 pages, none of them invented. 253 of those are prose, and Opus called them
  clean, minor or material.
- **Table detection as such** (layout = table, within the 495): S4 has precision 73% and recall 82% (153/186).
- **Parity:** the shipped function over all 1,568,108 stored texts gives 4,379. The analysis script gave 4,401. The
  22 are gated pages with no Han in the body, which the analysis counted as distinct ratio 0 and the function does not.

**What is NOT measured, and it matters.**
- Every labelled invented page came from the strict screen's own flags, or from containment by eye that started
  from them. So the 136/136 recall is recall *among loop-shaped failures*.
- Invented text on a page the gate never raises is unmeasured. qa3's random 0/59 only bounds that at < 6%.
- **48,957 pages are table-shaped but not gated** (distinct < 0.30, or a table title). That is the stratum to sample
  next. It is the one place a quiet ±1-cell overrun could live.
- Most of the "invented" calls on dense grids are ±1–3 cells (道 13 vs 12, 軍 11 vs 9). Opus's counting on those was
  never checked against a second counter, except where Kanripo covers the page (below).

### Part B: backup reader bake-off

**Sample: 30 pages, chosen before any reader ran** (`bake.json`, `select.mjs`).
- 12 contained: the 10 confirmed-contained pages and 2 洪範皇極內篇 charts.
- 12 called invented in batch but not yet confirmed. One is the 三才圖會(七十七) p6 formation, where I counted the
  image by eye: 9 軍 per border row.
- 6 S4-flagged table pages that Opus had called clean.

22 have a Kanripo leaf aligned by the #5935 rule (own leaf, or between trusted neighbours). 3 of those leaves do not
cover the page: every arm scores CER 100% on them. 19 are usable.

**Arms. Each is one page per call, with the live OCR prompt "Standard OCR" v19.1 (hash 9d8f959e…), $0.**
- a. **Opus** via `claude -p --model opus`, image opened with Read.
- b. **Gemini 3.1 Pro High** via `agy -p` (`run-cli-arm.py`, plan mode). This is the only Pro on the CLI.
- c. **Kanripo**, the WYG leaf.
- d. **Figure**: no transcription.
- Paddle's stored text is scored alongside as the baseline.

**Against Kanripo (19 covered pages).** Over-count is the number of times a reading writes a character the leaf
prints, beyond the leaf's own count of it. It isolates the overrun failure from misreads and from column order.

| reading | pages read | median CER | over-count, sum | pages with over-count ≥ 3 | s/page |
|---|---|---|---|---|---|
| Paddle (stored) | 19 | 10.9% | **145** | 11 | GPU batch |
| **Opus (CLI)** | 19 | 11.9% | **39** | 5 | 26 |
| Gemini 3.1 Pro High (agy) | 17 (2 empty) | 21.9% | 82 | 8 | 144 |
| Kanripo | the reference | — | — | — | — |
| Figure | 0 transcribed | 100% by construction | 0 | 0 | — |

- **On the 4 洪範皇極內篇 chart pages** (t11–t14), the over-count is: Paddle 32 / 7 / 7 / 13, Opus 0 / 0 / 0 / 0,
  Gemini 18 / 0 / 11 / 7.
  - On t11 Opus wrote the counting rods as 一…九, a convention its own `<warning>` states. That gives it a CER of
    85% with no overrun. The prompt needs a rod convention before Opus is used on these charts.
- **Gemini's CER is mostly column order.** On t27 it has the same 140 characters as the leaf and a CER of 88%.
- **Gemini's reads were also unreliable to obtain.** 3 calls hit the CLI's 120 s print timeout before I raised it
  to 300 s, and 2 of 30 ended `denied_tool` (empty).
- **Opus typed 6 of 30 pages as diagram or illustration** and put them in `<image-desc>` with counts. One is the
  西遊記 illustration where Paddle invented the numerals 一–九十九. Another is the formation, where it counted
  "nine 軍" correctly. In effect Opus already does arm d by itself where it should.

**Cross-review** (family rule, one page per call, the same JSON prompt for both, `review-prompt.txt`):

| reviewer → reads | pages | invented | clean / minor / material | planted duplicated row caught | repeat stability |
|---|---|---|---|---|---|
| Gemini 3.1 Pro → Opus reads | 30 | 10 | 12 / 4 / 4 | 3/3 | 3/6 same verdict (accidental repeats) |
| Opus → Gemini reads (seeded 16) | 16 | 3 | 8 / 4 / 1 | 3/3 | — |
| on the same 16 pages | 16 | Opus reads 3 (t08, t16, t27) | Gemini reads 3 (t09, t15, t23) | | |

- **Gemini Pro is not a trustworthy reviewer here.** It flipped verdicts on 3 of 6 pages it happened to review
  twice, including clean ↔ invented on t15.
- **Kanripo contradicts 4 of its 10 "invented" calls on Opus reads:** t12, t14, t20 and t21 have an over-count of
  0–1. Of the other 6:
  - t08: per-column header repeats in a spanned header. That is a layout convention.
  - t27: "silently corrects" a cell; over-count 0.
  - t16 and t19: Kanripo does not cover these, so they are open.
  - t03 and t10: 1–3 characters each, plausible.
- That leaves **Opus's invented rate at 2–4 of 30 pages, and each is small** (≤ 3 characters where checkable). The
  ≥ 10-character overruns the strict screen exists for appear 0 times in the Opus reads that Kanripo covers.
- Opus's review of Gemini found real structural errors: a scrambled right-hand table (t15), dictionary entries
  scrambled with added phrases (t23), and mirrored labels on a diagram (t09).

**Kanripo's licence (checked 2026-10-11, not assumed).**
- The GitHub organisation profile (`github.com/kanripo`) says "Licensed as CC BY SA 4.0".
- The work repositories carry no LICENSE file, no SPDX id and no licence line in `Readme.org` (checked KR3g0012,
  KR1a0123 and KR3k0039). kanripo.org shows no statement in its static HTML.
- So serving Kanripo text means CC BY-SA 4.0: attribution, plus ShareAlike on the served page text. That is a
  decision, not a default.
- **Coverage is also small.** Of the 159 invented-or-flagged-clean table pages, 96 belong to works with no Kanripo
  repo, which is most of 三才圖會 and 武備志 (Ming prints, not Siku). Only 43 align, and 3 of the leaves that align
  are empty: Kanripo leaves the diagram out.

### Recommended ladder for a flagged page (not adopted: wiring is its own decision)

1. **Detector:** `paddleTableRisk(text, {title}).flag` → hold the page; do not serve the Paddle text.
2. **Kanripo**, only if the CC BY-SA decision is taken, AND the leaf aligns `own` at dice ≥ 0.6, AND the leaf is
   non-empty. Expect it to cover well under a third of flagged pages.
3. **Opus by image** (`claude -p`, the live prompt plus a counting-rod convention line). Take it if a stable
   reviewer finds invented text on ≤ 10% of pages. Here it is 2–4/30 by a weak reviewer, and over-count fell 73%
   against Paddle on Kanripo-covered pages.
   - Capacity: 4,379 pages at ~26 s is ~32 h on one stream. qa3 found 10 pages per call costs no accuracy for Opus.
4. **Figure:** where Opus types the page `diagram` / `illustration`, serve its `<image-desc>` and no body. Where a
   second read disagrees on cell counts, also serve the figure.

**Gemini 3.1 Pro on agy is rejected as the reader and as the sole reviewer.**

**Unproven:**
- Counting on dense grids (±1–3 cells). Neither family's count was checked against a human.
- Invented text outside the gate (the 48,957 table-shaped ungated pages).
- Opus with a rod convention.
- Gemini cross-review covers all 30; Opus cross-review covers 16, set by the call cap.

### Calls and caps

- **Opus: 49 of the 50 cap.** 30 reads and 19 reviews, including the 3 controls.
- **agy: about 78 calls, against a cap of 70. The cap was overrun by about 8 calls.**
  - 76 are logged in `agy-calls.jsonl`, plus 2 that were killed in flight when I raised the timeout.
  - The cause: my wait loop missed the first review runner, so I started a second runner for the "missing" rows
    while the first was still running. The duplicates gave the 6-page repeat-stability check above.
  - I stopped as soon as I found it.
- $0 cash; no Gemini API call.
- Read-only Mongo: one projection read of all Paddle pages (~1.57M rows, zlib wire compression).

`n_books: 781` in the header is the books the shipped rule flags. The labels span 353 books, and the population is
10,985 books.
