---
stage: ocr
measure: [judged]
languages: [bo]
scripts: [Tibt]
canons: [tibetan]
n_books: 2402
n_pages: 889974
verdict: "A text-only detector for invented repeated lines in Tibetan OCR does not reach 90% precision. The final rule (an extra line beyond the book's usual count AND a near-copy pair within 3 lines) flags 7,568 of 889,974 pages (2,272 with served English, 849 books), but on 7 fresh pages checked by eye only 2 of 6 decided were real: the Kangyur's sutras repeat near-whole lines on the leaf, and volumes mix 7- and 8-line leaves. Flash, reading the image, dropped a line of the flagged pair on 2 of 56 pilot pages. Under Derek's severity rule, the one existing Flash batch audited end to end (router-30) FAILS: a severe error introduced on 4 of 10 pages, confirmed by a second judge (controls 20/20, 10/10), while the Derge guard passed all 30 (0.944 -> 0.967). Nothing was written."
status: rejected
decision: "No Flash correction surfaced or written (#6740). The detector lands as a worklist; the severity audit (leafcheck --severity, confirm-req, severity-gate), derge-guard-allow.mjs and severity-batch.sh land as tooling."
superseded_by: null
issue: [6740, 4523, 5771, 6560]
router_evidence: "none — not yet entered in router-table/rules.json (land-evals, 2026-10-29); the router-30 verdicts are in scripts/eval/results/tibetan-correct-6560/severity-6740/ (router30-gate.json.gz)"
---
## 2026-10-27 · Invented repeated lines in Tibetan OCR, and Flash corrections under the severity rule (#6740)

PRIOR ART: `2026-10-27-tibetan-flash-pass-production-6560.md` (#7477: rGyud 'bum Ka gate, NO-GO pooled worse 6/40),
`2026-10-15-tibetan-flash-pass-gate-6560.md` (rGyud 'bum Kha, NO-GO 10/40), `2026-10-27-tibetan-router-30-6740.md`
(the 30 folios re-audited here), and job tib-flash-correct-vol1-6740 (Neyphug rGyud Tsha, not touched here). The
detector's walk shape is `scripts/audit/ocr-loop-corpus.mjs`.

**Brief** (Derek, 2026-10-26 23:15Z): find invented repeated lines corpus-wide, surface existing agy Flash corrections
that pass the new rule, and correct the flagged pages. **The rule:** write a correction when it passes the automatic
guards (25% cap, END sentinel, ya-btags), does not lower Derge identity by more than 0.01 where a parallel exists, and a
10-page audit per 1,000 pages written (Opus judge B with controls) finds a severe error introduced on fewer than 2 of
10. SEVERE means an invented, duplicated or dropped line, a change of meaning or negation, or a wrong mantra.

### 1. Detector (`scripts/audit/tibetan-duplicate-lines.mjs`)
- **Walk:** 2,402 Tibetan books, 889,974 pages with OCR, read-only, checkpointed per book, about 13 minutes.
- **Cut 0, the brief's scan** (two lines of 12 or more syllables sharing 50% of their syllable trigrams) misses p.128 itself.
  Yigdzin's copies differ every few syllables, which breaks trigrams. It was replaced by a syllable Smith-Waterman score.
- **Cut 1** (score of 15 or more, and one or more lines over the book's usual count): 20 pages checked by eye
  (`detector-calibration.json`, sets A and B). 14 real, 3 false, 3 undecided.
- **Cut 2, the shipped `flag`** (the extra line, plus a near-copy pair at most 3 lines apart, score of 15 or more and at least 40% of
  the shorter line): tuned on those 20 pages, where it kept every decided true page and dropped every false one.
  **Checked on fresh pages (set C): 2 real of 6 decided** (1 undecided, the rest not reached). This is far under the
  90% bar, so the detector was not used to choose writes.
- **Why text cannot do it.** On C8 the leaf repeats lines 2 and 4 nearly word for word, and the OCR is right. On C5, C7
  and C8 the frames are 8+8 lines in volumes whose usual frame is 7+7, so "one line too many" is the scribe's. A
  whole-line character-similarity measure does not separate them either: the false pages score 0.83 to 0.96.
- **An ink-row line counter** (a projection profile over a margin strip) was prototyped to read the leaf's own line
  count. In two tuning passes it was off by 2 to 5 lines on most frames, so it was dropped and not shipped.
- **Counts, for the worklist only:** 7,568 pages flagged in 849 books (761 public). 2,272 of them carry served English.
  By engine: Yigdzin 6,318, woodblock-easter2 1,038, Gemini 212. At the measured precision, expect about a third to
  be real.

### 2. Inventory of existing correction reads (R2 `candidate-reads`, all boxes)
| run | model | pages | written | draft still stored | under the rule |
|---|---|---|---|---|---|
| tib-flash-pass-6560, rGyud 'bum Kha | Flash low | 415 | never | yes | not surfaced: #6758 judge B 10/40 worse; draft-wins include a lost negation (མ་ཡིན→མར), word swaps (གསུངས→བསམ, ཐོན→གནོད) and mantra changes |
| tib-flash-pass-6560, rGyud 'bum Ka | Flash low | 524 | never | yes | not surfaced: #7477 NO-GO; 48 substituted words, 2 dropped lines, 1 doubled verse in its 40-page audit |
| tib-g4-gate-6560, rGyud 'bum Kha | Gemini 4 Argon low | 426 | never | yes | not surfaced: its gate NO-GO (5/40), and the brief's rule is for Flash |
| tib-flash-correct-vol1-6740, wave 2 | Flash low | 120 (20 books) | never | yes | not surfaced: one-judge draft-wins that read as severe on about 11 of 38 audited pages; the confirmed run was cut off twice by session ends |
| tib-router-30-6740 | Flash low | 30 (30 books) | never | yes | **audited end to end: FAIL** (below) |
| tib-flash-correct-vol1-6740, Neyphug rGyud Tsha | Flash low | 960 | — | — | excluded: that job's volume |
The 6948 and 5771 pilots left no OCR correction reads in R2: 6948 was translation, and 5771 was Yigdzin re-reads.

### 3. The severity audit, run on router-30 (`pass/severity-batch.sh`)
- **Guards:** 30/30 pass. No ya-btags hits.
- **Derge guard (`derge-guard-allow.mjs`):** 30/30 placed. 0 refused. Mean identity rose from 0.944 to 0.967.
- **Audit:** 10 seeded pages.
  - Judge B with severity labels: 148 items.
  - A second sealed Opus on every severe draft-win (`confirm-req`).
  - The whole-page judge on the draft and on the correction (`page-req`).
- **Result:**
  - Severe error introduced on **4 of 10** pages, confirmed by both judges (bar: fewer than 2). **FAIL.**
  - Severe errors fixed on 7 of 10 pages: 17 severe spans fixed, 94 minor.
  - Controls 20/20, and the confirming judge's 10/10.
  - The introduced errors: བདུན་པ→བ་དགུ ("seventh"→"nine"), ཀར→པ་ན, བལ་གླང→བ་ལང, ཨཱ→ཞཱ (mantra), and བུ་མོས
    ("girl")→ཁྱིམ་ས་པ. The leaf shows the draft each time.
- **Read plainly.** Flash fixes more than it breaks on almost every page. But it puts a wrong word on about a third of
  pages, and the Derge identity guard cannot see it, because the many small fixes outweigh the one wrong word.

### 4. Pilot reads of flagged pages
56 of 120 flagged public pages were read by agy Flash-low with the CORR request. agy ran at 30–180 s a page, and two
session ends killed the run. Of those 56, Flash dropped one line of the detector's pair on only 2. It kept the same
line count on 27 and wrote fewer long lines on 14. Nothing was audited or written. The reads are kept in R2 (#7075).

### Undo
No page was written, so there is nothing to undo. `severity-batch.sh --apply` writes through `cli-ocr.mjs apply`
(`writePageText`, run id `cli-ocr-<stamp>`). `scripts/maintenance/revert-run.mjs --run-id <run>` undoes such a run.

Artifacts: `scripts/eval/results/tibetan-correct-6560/severity-6740/`.
Cost: $0. About 70 agy calls (56 reads plus re-reads) and about 45 Opus calls: 10 span, 20 page, 5 confirm, plus ya-btags checks for wave 2.
