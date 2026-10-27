---
stage: translation
measure: [stability]
languages: [lzh]
scripts: [Hani]
canons: [chinese-classics]
n_books: 15
n_pages: 60
verdict: "block-drift's new caseless (Han) branch catches all 5 by-eye page-break moves in #7518's agy block reads (3 at 4/call, 2 at 2/call) and flags 3 of the 90 breaks of the two 1/call runs (3.3%), in-sample. Held out on ~400 sampled Chinese books, one-page-per-call lanes flag 3.6% (Opus), 4.1% and 6.3% (3.8 Flash-low); the block Batch lanes flag 8-9%."
status: adopted
decision: "Ship the branch opt-in, on in claude-translate.mjs (the subscription block reader, --cli=agy|claude); the paid block lanes stay as they were. A hit reads both pages again alone."
superseded_by: null
issue: [7503, 5021]
---
## 2026-10-27 · A page-break drift guard for unpunctuated Chinese (#7503, job caseless-drift-7503)

PRIOR ART: `scripts/lib/block-drift.mjs` (#5021) is the guard; it made no claim on caseless scripts, because its
source test is a lowercase opening letter. Extended there, not beside it. The calibration set is #7518
(`2026-10-27-agy-pages-per-call-siku-7503.md`, `scripts/eval/agy-per-call-7503/`).

**Question.** Inside an agy block read of Siku pages, the model finishes the sentence that runs over a page break on
page N and opens N+1 at the next sentence (#7518: 2 of 26 in-block breaks at 2/call, 3 of 39 at 4/call). Can a rule
read from the text we hold catch that in Chinese, and stay quiet where no move can happen?

**The rule** (`detectCaselessDrift`). The English is cased, so the translation half of #5021 stands. The source half
is read from the SKQS column layout, since the OCR has no punctuation:
1. **The source runs over.** Page N's last prose column is full (within one character of the page's 75th-percentile
   column) and does not end on a final particle (也矣焉哉乎歟耶耳).
2. **N+1 opens no new entry.** No claim if N+1's source opens with 正義/案/按/注/疏/存疑, has 曰 within its first five
   characters (a speaker), or has a final particle on its first or second character.
3. **English N closes and English N+1 opens fresh.** N ends on sentence-final punctuation and N+1 opens on a capital
   or digit. Alternatively N ends on `;`, a list item closed on N, and N+1 may then open lowercase.
4. **Page N carries more English per source character than N+1** (`caselessShift > 0`). The clause has to have gone
   somewhere.

Rules 2 and the `;` branch were added after reading the misses and false flags, so the calibration numbers are
in-sample. The held-out floor below was not used to fit anything, except that its first 16 Flash-low flags were read
by eye (they gave rule 2).

### Calibration: #7518's reads (`calibrate.mjs`, `results.json`)

| set | flagged |
|---|---|
| the 5 by-eye moves | **5/5** |
| 1/call breaks (A1 + A1b), read as if they were blocks | **3/90 (3.3%)** |
| in-block breaks with no known move (B2 + C4) | 2/60 |
| C4 (4/call) in-block breaks, all | 3/39, the 3 known moves |

The 3 one-per-call flags: 大學衍義補 p.123 (`;` branch), 易通變 p.83 (A1b mistranslated 二分 as "equinoxes" and opened
fresh), 春明夢餘錄 p.70 (A1b re-opened 于厥後 with a capital). The 2 block flags: B2 天原發微 56→57, which finished
伏|羲來 on p.56 (two characters of a split word), and B2 御定佩文韻府 11→12.

The weakest catch is B2 論語商 37→38, with a shift of 0.02. B2 moved 10 characters and opened the next sentence fresh.
Any shift threshold above 0.02 loses it.

### Held-out floor: production Chinese translations (`floor.mjs`, `floor.json`)

About 400 sampled Chinese books, minus #7518's 15. Pairs are consecutive pages translated by the same call site, with
N+1's OCR in Han script. A one-page-per-call lane cannot move a clause it never saw, so its rate is the floor: false
flags plus words the reader finished across the break (`不可以及|遠` → "cannot reach far.").

| lane (call site, model) | pages per call | breaks | flagged |
|---|---|---|---|
| cli-translate.mjs, claude-opus-5-5 | 1 | 3,870 | **3.6%** |
| cli-translate.mjs, gemini-3.8-flash-low | 1 | 592 | **4.1%** |
| stale-retranslate-6567.mjs, gemini-3.8-flash-low | 1 | 6,897 | **6.3%** |
| translate-batch-chained.mjs, gemini-3-flash-preview | block | 23,534 | 9.4% |
| translate-batch-chained.mjs, gemini-3.1-flash-lite | block | 2,519 | 8.1% |

Raising the shift threshold to 0.03 brings the 6.3% lane to 4.5% and loses the B2 論語商 catch (sweep on an earlier
sample: 0.015 gives 5.1%, 0.05 gives 3.6%, 0.1 gives 2.2%). The shipped threshold is 0.

**Reading.**
- The block Batch lanes sit 3–5 points above the one-per-call floor. So roughly 3–5% of in-block breaks in Chinese
  English already served likely carry a clause a page early. That is the #5021 defect in the paid lanes, which this PR
  does not switch on.
- **Cost of a hit**: both pages are read again alone, never a wrong text. At 4/call on #7518's reads, 3 flags in 39
  breaks re-read 6 of 60 pages, taking the quota index from about 0.55 to about 0.65 of 1/call.

**Caveats.**
- n = 5 positives. The rule is fitted on them.
- The held-out floor counts word completions as flags, so it bounds the false-positive rate from above, not exactly.
- The held-out sample is a Mongo `$sample`, so it is not seeded. Two pulls gave 5.8% and 6.3% on the stale-retranslate
  lane.
- Han only. Tibetan (caseless, but punctuated by shad) has no calibration set and still makes no claim.

Files in `scripts/eval/caseless-drift-7503/`:
- `calibrate.mjs`, `results.json`
- `floor.mjs`, `floor.json`
- `ocr.json`: the OCR of #7518's pages, a Mongo snapshot from 2026-10-27

Fixtures: `tests/fixtures/block-drift/caseless-boundaries.json`. Read only, nothing written.
