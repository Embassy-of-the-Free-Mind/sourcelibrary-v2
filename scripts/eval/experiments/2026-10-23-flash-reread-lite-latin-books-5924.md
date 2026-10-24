---
stage: ocr
measure: judged
languages: [la]
scripts: [Latn]
canons: []
n_books: 10
n_pages: 250
verdict: "A Flash 3.8 re-read (agy) of 250 spread body pages from 10 fresh lite-read Latin books cut the pages a blind Opus reader called misleading from 102 to 20 (41% → 8%). Readers preferred Flash on 201 pages, lite on 23, with 26 ties. The preregistered bar FAILS on its second half: 7 pages are worse. 3 of those are Flash reads cut off by Gemini's recitation filter, which the existing cli-ocr guards already refuse to write. 4 are genuine Flash misreads: a dropped printed line, 4 dropped lines, intelligentem → intelligibilem, lib. 2 → lib. 1. Against them, lite is misleading where Flash is not on 89 pages. All 10 books fail the 25-page check, and one book (69bd9d05…) serves the next leaf's text on every page; it was contained."
status: informational
decision: "No production write. As registered the test fails, so no plan is adopted. Whether a net bar (4 worse vs 89 better, guarded) should replace 'no page worse' is Derek's call. The price if it does: the 25-page check flags every lite-read book in the frame, so the rule reduces to re-reading all 992 books (444K lite pages). That is about 467K agy calls, about 85 days of the account's whole Flash quota, plus about $450 of lite Batch retranslation from gap-fill."
superseded_by: null
issue: [5924]
---
## 2026-10-23 · Does a Flash re-read halve the misleading pages of lite-read Latin books? (#5924)
<!-- PRIOR ART: 2026-10-22-latin-served-pages-by-eye-and-facing-bleed-5924.md (the spot check this tests: lite 3/12 misleading vs flash 2/24) and 2026-10-22-latin-ocr-repair-census-5924.md (PR #7173: 25 spread pages decide the book). -->

**Question.** The 2026-10-22 spot check found misleading pages on lite OCR at 3/12, against 2/24 on flash. Ranked
improvement #1 on #5924 was therefore to re-read a lite book with Flash when an image check of 25 spread pages fails.
Derek approved the recommendation 2026-10-23. This is the test of it.

**Design** (`scripts/eval/flash-reread-5924/PREREGISTRATION.md`, committed f9a56e374 before the draw).
- **Books.** 10 fresh books, `draw.mjs` with Mulberry32(51023):
  - visible, Latin, 1500–1800, ≥ 100 OCR pages, ≥ 70% of pages read by flash-lite;
  - every id in a prior #5924 eval file excluded;
  - a format screen by one Opus reader (14/14 printed Latin; the first 10 taken).
- **Pages.** 25 spread body pages per book.
- **Arm L.** The stored lite OCR, as served (long-s pass of PR #7223 included).
- **Arm F.** `gemini-3.8-flash-low` through `agy` 1.4.6, using `cli-ocr.mjs read` unchanged: plan mode, one page per call, tool gate, the #6331 nudge. 263 calls for 250 pages, 0 nudged, 0 unread. Run on the main box, because l7a's agy is not signed in.
- **Step A.** Unblind by-eye check of L, one Opus reader per book.
- **Step C.** Blind pairwise with fresh Opus readers, X/Y order from Mulberry32(1023). Each read gets a misleading / flawed / sound verdict, then a preference, with "material" marking a loss that changes meaning.

**Result** (`results/score.json`; Wilson 95%)

| | misleading pages | |
|---|---|---|
| L, Step A (unblind) | 83 / 250 (28–39%) | agrees with Step C on L: both 80, A only 3, C only 22 |
| **L, Step C (blind)** | **102 / 250 (35–47%)** | |
| **F, Step C (blind)** | **20 / 250 (5–12%)** | **bar 1, halves: pass** |
| without the wrong-leaf book | L 77/225 · F 15/225 | |

- **Preference:** F 201 · L 23 · tie 26. A material loss for L on 106 pages, for F on 7.
- **Bar 2, "no page worse": FAIL, 7 pages.**
  - 3 Flash reads stop mid-line with "This request was blocked by Gemini's filters…" spliced into the text: `69b51e7f` p238, `69af0a0a` p60 and p116. All 7 filter-cut reads in the run (4 more are on the wrong-leaf book, where L was misleading anyway) carry `chatter: refusal` and `wrapper: reply cut before <<<END>>>`, so `cli-ocr apply` would keep the old text.
  - 4 are real Flash misreads:
    - `69b51e67` p131: *lib. 2* → *lib. 1*;
    - `69b51e18` p353: about 4 lines of Jerome's gloss skipped;
    - `69b51eba` p49: *intelligentem* → *intelligibilem*;
    - `69b638be` p174: the last printed line dropped.
- **Post hoc, guarded** (F where the guards pass, else L; not a verdict): misleading 17/250, worse 4.
- **Facing strip:** visible on 65 pages. L read it in on 8, F on 0, which replicates the spot check's 11/11.
- **The 25-page check:** every one of the 10 books has ≥ 2 misleading L pages (Step C; 9/10 by Step A). On lite-read Latin, the check does not separate books. Lite misleads on 8–76% of pages per book.
- **Containment.** `69bd9d056120d54bd0372a3a` (*Verae alchemiae*, 1561) serves the NEXT leaf's OCR and English on 25/25 pages. The offset is +1 throughout: image p.220, text p.221, verified by eye on the served image too. It was held (`wrong-leaf-text-5924`) and its English withheld on 575 pages (revisions saved; 15 quotes withdrawn). Flash read the right leaf there, apart from 4 filter cuts.
- **Instrument note.** On 2026-10-23 agy self-updated to 1.4.6, which opens images with `read_file`. The #6523 tool gate denied it, so the model never saw the page and wrote an invented one (#4763). The first dispatch of this run stopped on it. The gate fix is PR #7237. Every read here logged the image opened.

**Price if Derek accepts a net bar** (not adopted; nothing written):
- **Frame:** 992 lite-read books, 444K lite pages (`frame-size.mjs`, 2026-10-24). At 1.05 calls a page that is about 467K agy calls: **about 85 days** of the shared account's measured ~5,500 calls/24 h. It would compete with every other agy lane, including the pending Siku decision.
- **Gap-fill:** an OCR write marks the translation stale and retranslates it. At lite Batch $0.00102 a page (#5700) that is **about $450**, or about $970 on Flash.
- **Alternative:** a paid Flash Batch re-OCR at $0.00283 a page (#5700) is about $1,260 plus retranslation, in about days, not months.

**Grade.** Exploratory (10 books). Readers were Opus subagents, with no human calibration.

Files: `scripts/eval/flash-reread-5924/` (`draw.mjs`, `pairs.mjs`, `score.mjs`, `frame-size.mjs`, `crop.mjs`;
`results/`: sample, format screen, Flash reads, Step A and Step C verdicts, score). Cost $0: agy subscription calls and Claude subagents.
