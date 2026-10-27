---
stage: translation
measure: [judged]
languages: [lzh]
scripts: [Hani]
canons: [chinese-classics]
n_books: 20
n_pages: 2926
verdict: "20 held Siku books (2,926 pages), agy gemini-3.8-flash-low, 4 pages/call with the caseless drift guard. 2,923 written, then all reverted because the QA missed the draft gate: route-judge Opus, image attached, 30 pages, 5/5 planted controls caught. Usable 60% [42-75], sense errors 13/30 (bar <= 10), 6 pages with made-up glosses or text. The same judge on 30 of the skqs-flash-pilot-5600 1/call pages, which are kept as drafts: usable 70% [52-83], sense errors 17/30. So the pilot is not worse than what is served; the judge is stricter than the hand grading the gate was set on. In practice 4/call ran at 1.75 pages/call (23% of Siku pages are under the 200-char block floor), so quota per page was 0.81 of 1/call, not 0.55."
status: undecided
decision: "Pages reverted per the brief. Whether to undo the revert, and on which instrument the Siku draft gate is measured, is Derek's call (#7503)."
superseded_by: null
issue: [7503, 5600]
---
## 2026-10-27 · Siku translation pilot, 20 books at 4 pages/call on agy Flash-low (#7503, job siku-pilot-7503-cl)
<!-- PRIOR ART: 2026-10-27-agy-pages-per-call-siku-7503.md (#7518: the 60-page per-call eval this pilot scales up); the skqs-flash-pilot-5600 pilot on #5600 (1/call, the same cohort, hand-graded gate). -->

**Question.** Does the 4/call block lane (#7518) with the caseless drift guard (#7525) hold up on whole Siku books, and what does it cost in shared agy quota?

**Books.** `draw.mjs` (seed 7503, PR #7543) drew 20 books held `paddle-zh-5600-ocr-only` with no English, 5 per pages_count quartile: 2,926 translatable pages. All 20 were re-checked before the read: still held, 0 translated, and in no `lane_job_books` list. None was dropped.

**Read.** `claude-translate.mjs read --cli=agy --per-call=4 --job=siku-pilot-7503` in 4 processes of 5 whole books each. No `--fresh`, and no kept reads were found to reuse. The OCR-first gate passed without `--ocr-checked` (731/737 Paddle in the first group).

| | value |
|---|---|
| agy calls | **1,676** (1.75 pages per call) |
| block calls | 591: 455×4, 47×3, 89×2 |
| alone calls | 1,085 |
| pages under the 200-char block floor (always alone, and each ends a block) | **665 of 2,926 (23%)**; median page is 226 OCR chars |
| drift/seam guard hits | 86 blocks (15% of block calls); 185 pages (6.3%) re-read alone |
| refused (`page_tags_mismatch`) | 5 calls, each re-read alone |
| timeouts | 27 block calls (see below) |
| failed pages | 1 (refused twice, then failed alone), plus 2 refused by the write door (hidden-meta, stray-script) |
| tokens | input 14.48M (2.94M cached), output 1.56M, thinking 2.8K |
| per page | input 4,950, output 534 |
| quota index (input + 6×output, #7518's assumed weight) | 8,160 per page: **0.81 of #7518's 1/call arm** (predicted 0.55-0.65). Counting uncached input only, about 1.1, because cache hits were rarer than in #7518. |
| Gemini weekly (shared account) | 0.650 → 0.638 over the run. **That 0.012 is an upper bound**: other jobs used the same account in the window, and this box keeps no per-job ledger. |

**agy hangs after a complete reply.** In the first 75 minutes, 27 of 303 block calls ended at the 360 s kill. Each raw reply held all four page tags, closed, and agy's `usage` was printed. So the CLI had written its whole JSON and then never exited. Each block was retried, hung again, and was then read alone. That cost about 40 minutes per process. PR #7549 keeps a printed SUCCESS reply after a 10 s grace. The readers were restarted on it (same OUT dirs; finished pages skipped), and the rest of the run had 0 timeouts.

**Apply and revert.** `cli-translate.mjs apply` produced four runs: `cli-translate-20261027143422` (737), `-143505` (735), `-143548` (721) and `-144007` (730), 2,923 pages in all. A dry-run `revert-run.mjs --run-id` listed every written page as restorable for each run (PR #7543 works). After the QA, all four were reverted with `--apply`. Each run reported 0 changed since, and every book was recounted to 0 translated. The books stayed held and `visible` throughout.

**QA.** `qa.mjs`: 30 served pages, 1-2 per book across all 20 books (seeded), judged blind by Opus with route-judge-6740's `judgePrompt` and the page image. #7518's five planted controls (3 dropped sentences, 2 next-page sentences, each from a separate fresh read) were shuffled in. **5/5 controls caught**, so the probe is ok.

Column mapping (page-error-taxonomy codes; `cosmetic` never counts):
- sense: O6/O7/T7/T8
- omission: T1/T9/O5
- bleed: T4/T5/T6
- wrong-leaf: I1
- invented: O1/O3/T10
- names: a non-cosmetic defect whose note is about a name or title

| arm (n = 30, Wilson 95%) | usable | sense error | omission | bleed | names | wrong-leaf | invented | wrong_text | fidelity |
|---|---|---|---|---|---|---|---|---|---|
| **pilot, 4/call** | **60%** [42-75] | 13 (43%) [27-61] | 2 [2-21%] | 0 [0-11%] | 6 | 0 | 6 | 5 | 3.87 |
| calibration: skqs-flash-pilot-5600, 1/call, kept as drafts | 70% [52-83] | 17 (57%) [39-73] | 1 | 2 | 5 | 0 | 2 | 4 | 3.87 |

What "invented" holds in the pilot, by hand:
- One page puts five numerals ("One … Five") in a `<margin>`. They come from the panels of the stitched spine and probably arrived through the OCR.
- Five pages have made-up notes (T10): a Shuowen structure gloss, a "scribal error" emendation that follows a misread hexagram name, a courtesy name pinned on the wrong Ruan, a guessed particle, and a garbled gloss of 端正月.

Re-graded by hand on the skqs pilot's own rubric (a clause whose meaning changes), 12-13 of the 13 sense pages still count. Examples: ailanthus called "stink chinquapin"; 已然 turned from "already" into "before"; 姤 read as 歸妹; who grieves reversed.

**Result against the bars.**
- The draft gate (0 wrong-leaf, 0 invented, sense errors ≤ 1 page in 3) is missed on sense errors, and on invented notes if T10 counts. **So the run was reverted, as the brief required.**
- The routing floor (usable ≥ 75%) is missed too, so no routing row was opened.

**But the instrument is the finding.** Under this judge, the 1/call drafts Derek kept on 2026-10-27 miss the same gate more widely: 17/30 sense errors. The pilot's numbers lie inside theirs on every column. That gate (7/30) and the 75% floor (#7518's judge, a side-by-side prompt) were both measured on different instruments from this one.

On this judge, then, 4/call is **not shown to be worse than the 1/call drafts already served**. It only fails a bar that was set on a gentler grader. Until one instrument is fixed for the Siku draft gate, a pass or fail here is a statement about the judge.

**Quota projection (upper bound, from 0.012 of a week for 2,926 pages).**
- Rate: ≤ 0.0042 of a weekly pool per 1K pages, so one account's full week covers at least about 240K pages.
- All ~1.37M Siku pages ≈ **5.7 account-weeks of a full pool**.
- With #5600's framing (other lanes burn about 0.60 a week, keep a 0.25 floor, so 0.15 a week is spare): **about 38 weeks** on one account. Each further account with its own pool adds about 240K pages a week.

The saving over 1/call is small, because 23% of pages never block. Lowering `MIN_OCR_CHARS_FOR_BLOCK` for Han text (200 Han characters is most of a half-leaf) is where the remaining saving is.

**Caveats.**
- n = 30 per arm, and the two arms are different books and pages: neither paired nor powered to tell 60% from 70%.
- One judge.
- The calibration arm's text is what is served now, which is also the text the hand-graded gate passed.

Files: `scripts/eval/siku-pilot-7503/`
- `qa.mjs`
- `results/`: `qa-score.json`, `qa-score-calibration-skqs-1call.json`, `verdicts-*.jsonl.gz`, `packet-*.json.gz`, `reads-tally.json`, `runs.json`
- `draw.mjs`, `draw.json`, `page-ids.json`

Reads and logs are under `/data/scratch/sl/jobs/siku-pilot-7503-cl/` on cloudlayer.
