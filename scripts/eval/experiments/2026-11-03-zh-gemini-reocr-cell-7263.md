---
stage: ocr
measure: [judged]
languages: [zh]
scripts: [Hani]
canons: []
n_books: 60
n_pages: 60
verdict: "Do not re-read the 122,783 live Gemini-read Chinese pages with PaddleOCR. Correct them with Opus. Most of the frame is not print: 93,277 pages (76%) are in the Siku Quanshu cohort, whose hand copies Gemini mostly tagged printed, and only 29,506 are in true print books. On 30 print books and 30 Siku books (one page each, blind Opus judge with the image, wrong-page controls 4/4 rejected), accepted pages were: print, stored 3/30, Paddle 6/30, Opus correction 26/30; Siku, stored 8/30, Paddle 14/30, Opus correction 26/30. Wrong-text pages: print 22, 21 and 2; Siku 18, 14 and 1. Severe defects per 1,000 characters: print 19.7, 16.4 and 1.2; Siku 18.9, 11.0 and 0.9. Neither Paddle gain separates from zero in acceptance (print +0.10, CI -0.03 to +0.23; Siku +0.20, CI -0.03 to +0.43). The Opus gains do (+0.77 and +0.60, lower bounds +0.60 and +0.43). Paddle's coverage guard refused 12 of 30 print pages; with it off Paddle reaches 7/30. Paddle, which never saw either text, took the Opus reading over the stored one 132 to 22 (print) and 39 to 3 (Siku) where the two differ, so the margin is not only an Opus judge preferring Opus."
status: undecided
decision: "No write and no routing change: current.json and the routing tables are untouched. Recommended: gemini>opus via correct.mjs, about $340-620 of subscription quota for the frame (7-13 Claude account-weeks), print books first, not a Paddle re-read. English written from these pages goes stale on about 59% of the frame by this sample (29/30 print, 14/30 Siku), and re-translation is priced separately. This needs Derek: the 2026-11-02 rule keeps Opus for where nothing else clears the hard floor. The untested cheaper candidate is Paddle > agy Flash-low on these pages."
superseded_by: null
issue: [7263]
router_evidence: "none — the export is in router-table/evidence/zh-gemini-reocr-7263.score.json (+ by-script), per stratum, and router-confirm/results/chinese-gemini-*-2026-11-03.json. rules.json does not name it: the brief changes no table and the 2026-11-02 rules are frozen for a month (same handling as 2026-11-03-korean-ocr-cell-7982.md)"
defect_rates: "scripts/eval/zh-gemini-reocr-7263/results/score.json"
---
## 2026-11-03 · Should the Gemini-read Chinese be re-read? PaddleOCR vs Opus correction, on the same pages (#7263)

PRIOR ART:
- `2026-10-28-correct-vs-reread-wave1-zh-de-grc-7568.md`: Opus correction of Flash-Lite Chinese print, misleading pages 57/75 → 5, in 3 books.
- `2026-10-28-router-tests-agy-flash-low-gpu-draft-7263.md`: stored 3 Flash 7/30, agy Flash-low as its corrector 6/30.
- `scripts/eval/router-confirm/confirm.mjs`: drop and judge stages run as they are, on a plan written here. It takes a `lang_name` from the plan now, one line. `v4Verdict`, `per1k` and `judgeItems` imported.
- `scripts/gpu/paddle-print-gpu.sh`, `scripts/gpu/paddle-zh-queue-task.sh`, `scripts/batch/ocr-convergence/correct.mjs`: run unchanged.
- `2026-11-03-korean-ocr-cell-7982.md`: the PPS draw and the handling of the router evidence.

### The frame is not what the brief assumed

Live Chinese pages (`visible`, `pages_count > 0`, language Chinese or Classical Chinese) whose `ocr.model` is gemini-3-flash-preview or gemini-3.1-flash-lite*, counted 2026-11-03 (`results/frame.json.gz`): **122,783 pages in 10,985 books**.

| model | pages |
|---|---|
| gemini-3-flash-preview | 102,948 |
| gemini-3.1-flash-lite | 13,456 |
| gemini-3.1-flash-lite-preview | 6,379 |

| tag on the page (ocr `<script>`, else `pages.script_type`) | pages |
|---|---|
| printed | 94,595 |
| none | 16,315 |
| handwritten | 9,611 |
| mixed | 2,262 |

The tag misleads. A first draw over "printed" pages came back almost all Siku Quanshu volumes, and the first sheet of 10 all showed the 欽定四庫全書 layout. Split by cohort instead (the Siku holds in `paddle-print-lane.mjs`, or a juan-and-volume title):

| cohort | books | pages | tagged handwritten | books with one frame page | pages per correct.mjs call |
|---|---|---|---|---|---|
| Siku Quanshu | 10,774 | 93,277 (76%) | 9,004 | 5,503 | 5.4 |
| print | 211 | 29,506 (24%) | 607 | 4 | 9.7 |

That the Siku pages are hand copies comes from the cohort (#5600), not from a call on each page. A title-and-hold rule can misfile a book, and a few Siku-titled volumes may be printed.

### Design

Set before any arm ran, except where marked.

- **Two strata instead of one (changed from the brief).** The brief's 30 print pages would speak for 24% of the frame. So 30 print books and 30 Siku books, each with its own lane's settings. Stated separately, and weighted by frame only in the one line that says so.
- **Draw.** Seed 20261103, books with probability proportional to frame pages (no replacement), one page uniform among interior pages. A book-uniform draw would be half one-page residue books. Page rule: Flash-Lite or 3 Flash text, not human-edited, not withheld, `<page-type>` text or none, 100+ Han and kana, not tagged handwritten or mixed. Books held for a known text fault are left out (about 1,400 pages).
- **Evidence.** Left out: books named in any source a `chinese-*` or `zh-*` cell of rules.json cites, the #7866 results, the router's evidence folder, the #7568 Chinese results, `lane_judge_verdicts`. A first scan of every id under `scripts/eval` excluded 265 of 333 books, because coverage lists name most of the frame, so it was narrowed to judged pages.
- **By eye.** Contact sheets of all 48 + 36 drawn pages before any arm: no handwriting in the print stratum, Siku layout throughout, 0 dropped, first 30 kept. The print 30 include the Legge and Couvreur bilingual editions, kept as labelled. 19 of the print 30 and 25 of the Siku 30 are 3 Flash text, the rest Flash-Lite.
- **Arms.**
  - **S**: the stored text.
  - **P**: PaddleOCR-VL-1.6 on this box. Print: the split-leaf lane's GPU task (layout off, label crop, recheck), then `assemblePage` and the kana check. The lane runs `coversLite` on Flash-Lite pages only; here it runs on every page, since this test replaces 3 Flash reads too. Siku: the whole-page lane's task (layout on, 6 clients), then `convertPaddle` and its loop and character-run guards. A refused page serves S.
  - **Pu** (added after the reads, before any judging): the print read with the coverage guard off, because the guard refused 12 of 30 and P on those pages is S.
  - **O**: `correct.mjs --model=opus --per-call=10`, run as in #7568, `CANDIDATE_READS=off`. Unchanged or contain serves S.
- **Judge.** `judgeAbsolute`, blind to arm, image attached, one text a call, identical texts judged once, 2 wrong-page controls a stratum. 178 calls, all parsed.
- **GPU.** Queued as `153-zh-gemini-reocr-7263`, filler paused for the task only. The running SigLIP chunk gave up the card by the queue's own mechanism; this job stopped nothing. 60 pages, 73 s of reading, 3 min with model loads, card back to 2 MiB.

Not run: the router's name check, and the book-level guards that need more than one page (`underRead`, ditto marks).

### Results

Print (frame 27,812 pages after the exclusions):

| arm | accepted | wrong-text pages | severe / 1,000 chars (95% CI over books) | fidelity | refused → S |
|---|---|---|---|---|---|
| S stored | **3/30** | 22 | 19.7 (14.8–24.8) | 3.03 | — |
| P Paddle print lane | **6/30** | 21 | 16.4 (10.4–22.4) | 3.23 | 13 (10 lines missing, 2 shorter, 1 faint leaf) |
| Pu same, coverage guard off | 7/30 | 20 | 9.9 (6.3–14.1) | 3.43 | 1 |
| O Opus correction | **26/30** | 2 | 1.2 (0.3–2.5) | 4.50 | 2 (1 unchanged, 1 contain) |

Siku (frame 83,957 pages after the exclusions):

| arm | accepted | wrong-text pages | severe / 1,000 chars (95% CI over books) | fidelity | refused → S |
|---|---|---|---|---|---|
| S stored | **8/30** | 18 | 18.9 (13.6–25.6) | 3.17 | — |
| P Paddle whole-page lane | **14/30** | 14 | 11.0 (5.7–15.7) | 3.57 | 1 (textless table) |
| O Opus correction | **26/30** | 1 | 0.9 (0.1–1.9) | 4.73 | 2 (unchanged) |

Paired against S (d = accepted difference, 95% bootstrap CI):

| stratum | pair | d | gained / lost | wrong text made / cleared | severe Δ per 1,000 chars | rules.json bar |
|---|---|---|---|---|---|---|
| print | P−S | +0.10 [−0.03, +0.23] | 4 / 1 | 3 / 4 | −3.3 | pass |
| print | Pu−S | +0.13 [0, +0.30] | 5 / 1 | 5 / 7 | −9.8 | pass |
| print | O−S | **+0.77 [+0.60, +0.90]** | 23 / 0 | 0 / 20 | −18.4 | pass |
| Siku | P−S | +0.20 [−0.03, +0.43] | 10 / 4 | 3 / 7 | −7.8 | pass |
| Siku | O−S | **+0.60 [+0.43, +0.77]** | 18 / 0 | 0 / 17 | −18.0 | pass |

The bar is non-inferiority, so a pass says only that Paddle is not worse than S. It does not make Paddle good: at 21/30 and 14/30 wrong-text pages, Paddle pages would still mislead readers.

Frame-weighted over the two strata (accepted; wrong-text pages; severe per 1,000 characters): S 23%, 63%, 19.1. P 40%, 53%, 12.4. O 87%, 4%, 1.0.

By stored model, print: Flash-Lite pages S 0/11, Pu 1/11, O 9/11. 3 Flash pages S 3/19, Pu 6/19, O 17/19. S matches earlier measures of the same text: 3 Flash here 10/44 against 7/30 on 2026-10-28.

Wrong-page controls: 0 of 4 accepted, fidelity 1 on each.

Pages with an invented or wrong-leaf class (hard-floor classes, on the judge's labels): print S 9, P 6, Pu 2, O 2 (one of them the contain page below, which serves S). Siku S 4, P 1, O 0.

### Is it only Opus preferring Opus?

The judge and the corrector are the same model, so the O margin needs a check that does not use Opus. Paddle reads pixels and saw neither S nor O (`crosscheck.py`, `results/crosscheck.json`; no model calls). The check covers 52 of the 60 pages; on the other 8, O or Paddle equals S.

| where O differs from S | print | Siku |
|---|---|---|
| single characters: Paddle has O's reading | **132** | **39** |
| single characters: Paddle has S's reading | 22 | 3 |
| single characters: Paddle has a third reading | 22 | 4 |
| O's inserted runs of 4+ characters that Paddle also has | 935 of 1,006 chars | 1,569 of 1,603 chars |

Most of the large insertions pair with deletions of the same text elsewhere (Paddle has 692 of 720 and 947 of 1,095 of the deleted characters), so they are mostly reordered blocks: O restores reading order. Runs Paddle lacks are short, except where Paddle itself under-read (御定子史精華 below). This supports the direction, not the size. Whether O ever writes the known text in place of what the leaf prints was not separately tested, and neither was the name check; the router treats Chinese acceptance as an upper bound until one runs.

### By eye

- **六藝流別, 69f33c10…p510 (print, image open).** The leaf prints 吏亾姦邪民亾盜賊囹圄, 繆盭 and 況人虖. S has 吏以姦邪民以盜賊罔圖, 繆盬, 況人羣: a meaning-changing misread and silent normalising, on a clear page. O has all of them right. Paddle has them right too, with differences of its own elsewhere on the page (慱, 灰) that I did not settle against the leaf.
- **性命雙修萬神圭旨, 6a1d81af…p333 (print).** The leaf begins 出者有衝頂門; the stored text begins 府鰲宮欲去. Opus answered CONTAIN, correctly. The text of p334 begins 出者有衝頂門 as well, so the image and text at this point are off by one leaf. Book held, not contained here (below).
- **御定子史精華, 6a3c6552…p25 (Siku; character counts and the contact sheet, a full page of text).** Paddle wrote 30 characters where S has 310, and the whole-page lane has no guard against it. The print lane's coverage guard would catch this kind of page; the whole-page lane's would not.

### Prices per 1,000 pages

| route | price | basis |
|---|---|---|
| S keep | $0 | — |
| P Paddle on gex45 | ~$0.09 | the lane's figure (#7263); this run read 60 pages in 73 s, about 2,960 an hour |
| O Opus correction, print books | ~$2.77 | 6% of an account-week per 1K pages (#7568 Chinese, 10 a call) × $46 a week |
| O Opus correction, Siku | $2.77–5.72 | books average 5.4 frame pages a call; bounds at 10 a call and at 1 a call (rules.json `opus-img@1`, an upper bound) |

These are subscription quota priced at the fee, as the router prices them, not a paid API. This test's calls were one page each, so its quota draw is not the production rate; at API list price the 60 calls would have been $6.23.

For the whole frame: **Paddle about $11, 42 hours of one card. Opus correction about $340–620, or 7–13 account-weeks** (2–3 weeks of all four accounts).

### Limits

- n = 30 a stratum, one page a book. The Paddle intervals reach zero.
- O ran one page a call because each book gave one page; production at up to 10 a call is not measured here for these pages. #7568 was at 10.
- PPS means large books speak for their pages, so the 5,503 one-page Siku books are thinly sampled. They may be a harder residue, since Paddle's guards may have turned them away.
- Pages tagged handwritten (9,611) and mixed (2,262) were not drawn.
- Rewriting a page stales its English. Translated in this sample: print 29/30, Siku 14/30. Not priced into the table.

### Served text not contained

Read-only on Mongo by the brief, so nothing was withheld. `containment-on-finding.md` asks for a hold and a withhold on text found to be wrong with the image open, so a session with write access owes that for 6a1d81af…p333 (and #5021 may want the offset). The judge also put an invented-text class on 7 further S pages (`contain_candidates` in `results/score.json`); those are candidates, not checked by eye.
