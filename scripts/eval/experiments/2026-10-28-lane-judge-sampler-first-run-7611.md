---
stage: ocr
measure: [judged]
languages: [de, fr]
scripts: [Latn]
canons: []
n_books: 37
n_pages: 37
verdict: "First real run of the lane-judge sampler on what the #7558 correction lane served (agy Flash-low corrections of Flash-Lite drafts, 10-27 to 10-28). On print pages, German was accepted on 16 of 20 (95% CI by book 0.60-0.95), with wrong text on 1 of 20; its Flash-Lite drafts were accepted on 14 of 21, with wrong text on 4 of 21. French was accepted on 14 of 15 (0.80-1.00), with no wrong text; its drafts on 13 of 15. The correction raised German fidelity by +0.35 (0.10-0.65) and changed French by +0.07 (-0.20 to +0.33). No accepted draft lost acceptance, and no correction added wrong text. With this evidence pooled in, the router table makes the same route decisions: German print stays on lite>opus (agy-flash-low 44/50, short of the Opus bar), French print stays switched to lite>agy-flash-low (41/44). There are no containment candidates. The run stopped at its weekly cap of 80 calls."
status: informational
decision: "No routing change (the hold list is untouched). Pooled into the router as evidence/lane-judge-sampler.score.json plus its by-script cut. The nightly cloudlayer cron keeps adding to it."
superseded_by: null
issue: [7611, 7263, 7558]
router_evidence: [german-lite, french-lite]
---
## 2026-10-28 · Lane-judge sampler, first real run: the #7558 correction lane, German and French (#7611)

PRIOR ART:
- `scripts/eval/route-judge-6740/judge.mjs`: the judge. It is reused unchanged (same `judgePrompt`, same rubric, same template hash), and the page image is attached.
- `2026-10-28-router-tests-agy-flash-low-gpu-draft-7263.md`: the hand-run router tests of the same route. Those were pages drawn for the test. This run judges pages the lane actually served.
- `2026-10-28-router-next-print-manuscript-split-7263.md`: the print/manuscript cell split that this evidence feeds.

**What was judged.** These are pages the live correction lane wrote: `ocr.pipeline = agy-correct-lite-7558`, with the writer's `page_revisions` row still the page's text. There were 5,806 pages in 68 books from 2026-10-27 00:00Z to 2026-10-28 12:41Z. One page was drawn per book, with seed `20261028`. Books were weighted by `1 + ln(1 + books.human_read_count)`. Every book was eligible, because no cell yet had 60 judged books. That gives 68 pages and a queue of 140 calls (each corrected page, its draft, and 4 wrong-page controls). The judge was Opus via `claude -p` on the gex45 subscription (job lane-judge-run1-7611). The run stopped at the **weekly cap: 80 calls**. In those calls it judged 37 corrected pages, 38 drafts and 4 controls. One reply did not parse (an empty exit). The 4 controls all failed, as they should (fidelity 1), so both routes count.

**Results. Print pages only are counted as cell evidence. 95% CIs are a book-cluster bootstrap.**

| cell | route | accepted | 95% CI | wrong text | books |
|---|---|---|---|---|---|
| german-lite (print) | lite>agy-flash-low (served) | 16/20 | 0.60–0.95 | 1/20 | 20 |
| german-lite (print) | lite (the draft it replaced) | 14/21 | 0.48–0.86 | 4/21 | 21 |
| french-lite (print) | lite>agy-flash-low (served) | 14/15 | 0.80–1.00 | 0/15 | 15 |
| french-lite (print) | lite (the draft it replaced) | 13/15 | 0.67–1.00 | 0/15 | 15 |
| french-lite (manuscript) | lite>agy-flash-low | 2/2 | | 0/2 | 2 |

**Worse than the draft.** Each corrected page was compared with its draft on the same page.

| cell | pairs | fidelity change | 95% CI | worse | better | acceptance lost | acceptance gained | wrong text added |
|---|---|---|---|---|---|---|---|---|
| German | 20 | +0.35 | +0.10 to +0.65 | 1 | 7 | 0 | 3 | 0 |
| French | 15 | +0.07 | −0.20 to +0.33 | 2 | 3 | 0 | 1 | 0 |

All three "worse" pages are a one-point fidelity drop on a page that stayed accepted:
- German p. 56: a symbol is described wrongly.
- French p. 68: "fons" for "sons".
- French p. 121: a glyph is read as "M".

**Rejected corrected pages (5).** These form the retry queue for a GPU-draft>agy attempt. No page was changed.
- German `6a0a24020eca358f15e84edc` p. 119: O7, the numbers in "32 1/10 stadia".
- German `698420e4e8a1d0539ce47e1d` p. 589: O6.
- German `69b51ed3ff09e4fe943b565f` p. 225: O6 wrong text, "2c" for "&c".
- German `69b51e9647b06ecd58193ed8` p. 29: O6, two misreads.
- French `6a8ee22390f5a0e4155ea8f7` p. 191: O6, "font" for long-s "ſont", three times.

**What the router decides.** I ran `build.py` on main `5c8a6e0a0`, with this export pooled into the existing evidence. It was book-weighted as in #7606 and cut by script type.
- **german-lite/print: keep lite>opus.** lite>agy-flash-low was 28/30 from the router tests. With this run it is 44/50, with wrong text on 3 pages (mean 0.88, 90% CI 0.80–0.94). Opus is 272/280 (0.94). agy-flash-low is not within the switch margin of the Opus bar.
- **french-lite/print: switch to lite>agy-flash-low, unchanged.** It is now 41/44, with wrong text on 2 (mean 0.92, 0.85–0.97).
- **french-lite/manuscript: UNTESTED → HOLD.** This changes the decision's label, not its route. Two manuscript pages are under the 10-page floor.

The served German rate (16/20) is lower than the router test's (28/30). The intervals overlap, but the gap is the direction to watch as the nightly adds books.

**Price.** The cap is computed as 1 point of a week ÷ rules.json `judge_points_per_output` 0.0124 = 80 calls. During this run the account meter moved 73% → 77% weekly, and 13% → 45% on the 5-hour window. That is at most 0.05 points a call. It is an upper bound: the account is shared with about five other Opus jobs on gex45 that ran over the same 2.5 hours. The export carries this reading (`meter.points_per_call`) on every run, so a cleaner measurement can replace the 0.0124 if one is ever taken on a quiet account.

**Also in this PR.** I fixed two gaps in the nightly rebuild that would have broken tonight's cron:
- `build.py`'s script split (#7621) opens `script_split.waiting`, which the rebuild never copied. `build.py` crashed on the first line.
- The export had no by-script file, so `build.py` would have put the lane's pages only in `/unknown` cells. The export now writes `evidence/by-script/lane-judge-sampler.score.json`, with mixed pages counted as print as `split_evidence.py` does. The weekly PR commits that file too.

Store: Mongo `lane_judge_verdicts` (run `lane-judge-20261028124149`) and `lane_judge_runs`. Export: `lane-judge-sampler.mjs export`.
