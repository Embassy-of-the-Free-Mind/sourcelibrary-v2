---
stage: ocr
measure: [judged, stability]
languages: [deu, lat]
scripts: [Latn]
canons: []
n_books: 15
n_pages: 60
verdict: "Gemini 3.8 Flash-low OCR through agy, 60 German and Latin print pages (15 books x 4 consecutive, 5 books Fraktur). Blind Opus judge with the page and its neighbours' images; 5/5 planted controls caught. Usable: 1 page/call 55/60 and 59/60 (two fresh runs), 2/call 56/60, 4/call 58/60. Both block arms are inside the floor between the two 1/call runs. No cross-page bleed in any arm (0/240), and no order errors in the block arms. Tokens per page: 4/call 0.68 of 1/call (index input + 6 x output; 0.81 counting uncached input only), 2/call 0.87. The measured /quota deltas are not usable: the pool was shared with other jobs. Weak signal: more pages with a misread word at 2/call (+12 pts [+2, +23])."
status: undecided
decision: "Both block arms pass #7522's rule. Recommend 4 pages/call for agy OCR on print, once quota per page is measured on an idle pool. The production default is a separate PR (#7522)."
superseded_by: null
issue: [7522, 7503, 7517]
---
## 2026-10-27 · agy OCR, 1 vs 2 vs 4 pages per call, German and Latin print (#7522, job ocr-percall-7522)
<!-- PRIOR ART: 2026-10-10-paddle-zh-random-qa-6388.md "Context arm" (PR #6443): Gemini 3.8 Flash-low on 10 Siku Chinese pages, mean CER 12.1% -> 21.6% at 5 pages a call, one page's text matching no page of the call. That is the "12% -> 22%" #7503 cites. 2026-10-27-agy-pages-per-call-siku-7503.md (PR #7518) is the translation version; its draw/judge/score were reused here. -->

**Question.** One agy call pays the CLI's own context and its agent turns once, however many images it carries. If OCR keeps quality at 2 or 4 pages a call, each pool reads more pages. The one earlier image result went the other way (Chinese, 5/call, mean CER 12% -> 22%, PR #6443).

**Tool.** `cli-ocr.mjs read --per-call=N` (this PR). It sends up to N consecutive pages of one book in one agy call, as `p01.jpg … pNN.jpg`, on the live OCR prompt plus a block wrapper (`agy-cli.mjs ocrBlockInstruction`). The reply is split only by `<<<PAGE n BEGIN>>>` / `<<<PAGE n END>>>`, and any mismatch refuses the whole call. A refused call is retried once, then its pages are read one per call. Every existing guard and the provenance stay. The kept-read variant names the call's page count.

**Draw** (`ocr-per-call-7522/draw.mjs`, seed 7522, committed before any read). Frame: 2,393 visible German or Latin printed books with `human_read_count > 0`, idle in the pipeline (not held). From each drawn book, one run of 4 consecutive pages, each with no OCR or only a Flash-Lite read, never among the first or last 4 images.
- Two rules were added after looking at the first draws, before any read: manuscripts out (the first draw took two BPH Kurrent manuscripts), and the last 4 images out (the second took Atlas minor's spine and edges).
- Result: 8 German and 7 Latin books. 14 books had Flash-Lite reads and 1 had no OCR.
- By eye (`script.json`), 5 books are Fraktur, all German. That is short of the "about half" in the brief. The seeded draw was kept rather than redrawn to hit the share.

**Arms.** All 60 pages in every arm, gemini-3.8-flash-low, `--fresh`, `CANDIDATE_READS=off`, 3 calls at a time, run one after another (`run-arms.sh`): A1 1/call; B2 2/call; C4 4/call; A1b 1/call again (the noise floor). CTL is a separate fresh 1/call read of the 5 control pages.

**Account.** The main pool, not the second one. `AGY_HOME=/root/.agy-james` showed 0.6% and then 0.00% of its Gemini week (reset 2026-11-03). Derek's inbox note of 13:00Z confirmed: Antigravity serves that account Starter quota. All arms therefore ran on the shared main pool.

**Judge** (`prep.mjs`, `judge.mjs`). Opus via `claude -p --restricted --tools Read`, one page per call. The call's folder holds `this.jpg` and `prev.jpg` / `next.jpg` (the neighbouring pages), and nothing else. The versions appear under shuffled letters, and the arm key never enters the prompt. Faults recorded: omission, addition (printed on none of the three pages), cross-page bleed (printed on a neighbour), order error, misread, and usable.
- **Controls: 5/5 caught.** 3 drops (one body line taken out) and 2 bleeds (the next page's first line appended). Each came from its own fresh read. This is a result, not probe_broken.

| arm | usable (Wilson 95%) | omission | addition | bleed | order | pages with a misread | in / out tok per page | token index vs A1* | calls | refused |
|---|---|---|---|---|---|---|---|---|---|---|
| A1 1/call | **55/60** 92% [82–96] | 2 | 2 | 0 | 2 | 32 | 24,727 / 935 | **1.00** | 60 | 0 |
| A1b 1/call again | **59/60** 98% [91–100] | 1 | 2 | 0 | 1 | 29 | 26,764 / 933 | 1.07 | 60 | 0 |
| B2 2/call | **56/60** 93% [84–97] | 1 | 1 | 0 | 0 | 39 | 20,724 / 934 | **0.87** | 31 | 1 block, passed on retry |
| C4 4/call | **58/60** 97% [89–99] | 2 | 2 | 0 | 0 | 36 | 15,083 / 911 | **0.68** | 15 | 0 |

\*Input + 6 × (output + thinking) per page. The 6 is an assumption carried over from #7503, not a measured agy rate. Thinking was 0 on every call. Counting uncached input only (input − cache_read), the index is A1 1.00, A1b 1.20, B2 1.07, C4 0.89. Cached input varies between the two identical 1/call runs, so this variant carries about ±20% noise.

**Against the floor, not zero.** Paired difference in usable rate vs A1, with a 95% bootstrap that resamples the 15 books (`score.mjs`):
- A1b (the floor): +6.7 pts [0, +15.0]
- B2: +1.7 [−5.0, +8.3]
- C4: +5.0 [−3.3, +15.0]

Neither block arm is worse than A1, and both differ from it by less than A1b does. Usable verdicts disagree between A1 and A1b on 4 pages, A1 and B2 on 7, and A1 and C4 on 7.

**Page-break defects did not appear.** Cross-page bleed was 0 in all 240 judged reads. The block arms had no order errors. The #7503 translation defect (a sentence finished on the earlier page) has no OCR analogue here: each page held only its own printed lines.

**Misreads (a weak signal).** Pages where the judge listed at least one misread word, paired vs A1:
- B2: +11.7 pts [+1.7, +23.3]
- C4: +6.7 [−6.7, +21.7]
- A1b: −5.0 [−18.3, +6.7]

Fraktur usable was 20/20 in both 1/call runs and 19/20 in both block arms. The miss is the same page (Chymische Hochzeit p.132) and the same misread in both: *Leyter* read twice as *Leyer*. The two 1/call runs read it right.

**Unusable in the 1/call arms:** a footnote written twice (Jung p.73, both runs), long s read as f (Universae Geometriae p.564), a misread page count (Murr p.33), and a bracketed grammar table read out of order (Gaurico).

**Quota, measured: not usable here.** Before/after `/quota` per arm, the "after" taken 15 minutes past the arm's end (`results/quota.jsonl`). Weekly fraction used: A1 0.96 pts, B2 0.13, C4 0.14, A1b 0.20. In the same windows, other jobs on this box made 78–191 calls, and other boxes share the account but do not log here. The two identical 1/call arms differ about 5×, so these deltas measure the pool, not the arm. The 5-hour window also reset during B2. Quota per page per arm is **not measured**; the token index is the only cost figure.

**Decision (the rule in #7522).** A block arm is adopted if its paired usable difference vs A1 is no worse than the floor, and it shows no bleed that block-drift-style checks cannot catch. B2 and C4 both pass. Recommendation: **4 pages per call for agy OCR on print**. Its token index is 0.68 (0.81 uncached), and its quality cannot be told apart from 1/call at n = 60.

**Caveats**
- At n = 60, a difference under about 10 points is not detectable. Watch misreads in any rollout.
- The quota saving is inferred from tokens. Measure it on an idle pool before relying on it.
- These are good-to-moderate printed scans. Dense manuscripts and Chinese (#6443's 12% -> 22%) are not covered.
- 10 of 15 books are roman type. This draw does not test Fraktur at scale.

**Useful output.** Per page, the best judged read (usable, no omission, addition, bleed or order error, then fewest misreads; ties to the 1/call arms) was picked by `pick-best.mjs`. The picks went through `cli-ocr.mjs apply --apply --reason="#7522 best-of-arms, Opus-judged"`, run `cli-ocr-20261027144902`, with provenance kept.
- 59 pages had a clean pick (A1 35, A1b 12, B2 8, C4 4).
- **55 were written.** Four were refused by the foreign-script guard: real Greek in Irenaeus and the Assoziationsstudien, and real Hebrew in Galatinus. The guard was left as it is.
- One page (Gaurico p.107) had no clean read.
- Verified in Mongo by page id: 55/55 carry this run's gemini-3.8-flash-low OCR; 12 of them came from block calls.

**Contained in this run.** The 40% shared-words guard flagged Jung, *Zur Psychologie und Pathologie sogenannter occulter Phänomene* (1902, `69bd9abd46b01553e33bce57`).
- **102 of its 134 pages** serve Russian prose from another book as OCR and English.
- By eye, the images of pp. 30, 60, 73–76, 100 and 130 are Jung's German.
- The book is held as `russian-ocr-over-german-7522`, and the English of those 102 pages is withheld (`withhold-stale-translations.mjs --by-eye-pages`, revisions saved).
- A re-read is owed. Same shape as #5215 (Gesner).

Files: `scripts/eval/ocr-per-call-7522/` (draw, controls, prep, judge, score, quota, run-arms, pick-best) and `results/` (results.json with every verdict row, the letter key, tampers, quota readings, block call logs, choice.json, Opus verdicts). Spend: $0 (subscriptions). About 290 agy calls and 60 Opus calls.
