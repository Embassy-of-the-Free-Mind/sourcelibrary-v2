---
stage: translation
measure: [judged]
languages: [zh]
scripts: [Hani]
canons: []
n_books: 30
n_pages: 30
verdict: "Adding polarity, attribution and no-added-names lines to the Siku lane's translation prompt did not pass its preset rule. On 30 untranslated Siku manuscript pages, both arms on the same pages, Opus counted INVENTED + HIGH-risk errors 21 with the fix against 20 without (INVENTED 6 vs 8, HIGH 15 vs 12), 'show' pages 8 vs 6, severe errors 4.1 vs 4.4 per 1,000 English words. The Gemini second judge leaned the other way (24 vs 27; INVENTED 1 vs 5). Within noise."
status: informational
decision: "No prompt PR; the Siku lane keeps its prompt. No recommendation on the STOP file from this test: it neither clears nor condemns the lane."
superseded_by: null
issue: [5600, 7263]
router_evidence: "none — scored on the #5600 error-kind scale (show / caveat / dont, kinds and risks), not the route-judge accept scale that zh-siku-first-tr's evidence uses; pooling the two would mix scales (paper: one outcome, one definition)"
defect_rates: "none — severe errors per 1,000 English words from the error-kind verdicts (HIGH or MEDIUM, not STYLE / JUNK), in results/score.json"
---
## 2026-11-02 · Does a polarity / attribution / no-added-names fix help the Siku translator? (#5600)

PRIOR ART:
- `scripts/eval/siku-error-types-5600/judge.mjs`: the judge prompt, its kinds and risks, `parseVerdict`, all imported unchanged.
- `scripts/eval/siku-percall-5600/draw.mjs`: the lane's cohort through `rankBooks` and its exclusions, restated.
- `scripts/eval/eu-agy-translate-7263/run.mjs`: `opusJudgeCall` and `doorVerdict`.

**Why.** Dispatcher note, 2026-11-01 23:50Z ("Derek said do it"). The error-types study (`2026-10-30-siku-translation-error-types-5600.md`) traced 6 of the 7 HIGH errors on the served lane to the translator. Its proposed fix: polarity and attribution checks, plus a rule against glosses that add names or dates.

### Design (`scripts/eval/siku-fix-5600/run.mjs`, seed 56001102; the rule was written into the header before any read)

- **Frame.** The Siku lane's cohort:
  - held `paddle-zh-5600-ocr-only` / `gpu-backlog-5660` / `zh-histories-7546`, rung transcribed or translating, OCR on ≥ 80% of pages;
  - the residue, seal and #7090 books left out, plus the books of the two earlier Siku draws; no dupe sibling.
  - That leaves 8,495 books. In each drawn book, one untranslated interior page (15–95%) with 40+ Han. 30 books; all 30 pages are manuscript.
- **Arms**, the same pages, both through `cli-translate.mjs read`, gemini-3.8-flash-low, one page a call, `--fresh`, pool james:
  - **A**: the live lane, with its LEAF_LINES.
  - **B**: A plus three lines (`FIX_LINES`):
    - keep every negation, prohibition, condition and question;
    - keep who says, does, gives or receives, keep titles exactly (天子 ≠ Crown Prince), keep list items aligned;
    - add no name, surname, date, reign year, place or identification the source does not state, in the text or a note.
  - Then a dry `cli-translate.mjs apply` and translate-core's door. All 60 would be written.
- **Judges.**
  - Opus via `claude -p` with the page image and the error-types prompt. All 62 transcripts show `page.jpg` opened.
  - Gemini 3.8 Flash-low on agy, with the same prompt and the image attached, as the second, non-Claude judge (manuscript, paper decision 8).
  - Packets shuffled, no arm in the prompt.
  - 2 wrong-page controls: both judges said "dont" on both.
- **Rule.** B wins if, on Opus, INVENTED + HIGH errors are fewer than A's, AND "show" pages ≥ A's − 1, AND Gemini's INVENTED + HIGH also fall.

### Results

| | A (live lane), Opus | B (+ fix), Opus | A, Gemini | B, Gemini |
|---|---|---|---|---|
| show / caveat / dont | 6 / 20 / 4 | 8 / 17 / 5 | 10 / 19 / 1 | 8 / 18 / 4 |
| errors (per page) | 92 (3.1) | 75 (2.5) | 54 | 48 |
| INVENTED (pages) | 8 (7) | 6 (5) | 5 (5) | 1 (1) |
| HIGH-risk (pages) | 12 (8) | 15 (9) | 22 (16) | 23 (15) |
| **INVENTED + HIGH** | **20** | **21** | **27** | **24** |
| WRONG-SENSE | 43 | 41 | 20 | 14 |
| OCR-CARRIED | 10 | 5 | 16 | 20 |
| severe / 1,000 English words | 4.40 | 4.14 | 3.25 | 3.60 |

- **Paired** (Opus, INVENTED + HIGH, B − A per page): sum +2, 95% bootstrap CI per page [−0.20, +0.33].
- **B does not win by the rule.** Fewer errors overall (75 against 92) and fewer INVENTED on both judges. But HIGH-risk errors did not fall, and the two judges disagree on the total.
- **The lane's served English is mostly "caveat" on this frame**: Opus showed 6 of 30 as is. The error-types study's 16/30 "show" came from served pages of other books.

### Not checked

- n = 30, one draw.
- No by-eye reading of the HIGH errors.
- The judges' accuracy on classical Chinese translation is unmeasured (#7880 covers OCR).

Artifacts: `scripts/eval/siku-fix-5600/` (`run.mjs`, `results/score.json`). Reads and transcripts are in the job's scratch directory.
