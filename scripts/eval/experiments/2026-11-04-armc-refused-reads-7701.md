---
stage: ocr
measure: [judged]
languages: [la]
scripts: [Latn]
canons: []
n_books: 30
n_pages: 30
verdict: "Arm C's refused Flash reads are neither good text thrown away nor errors rightly caught: half are readable and many carry wrong text. Share stratum ('only N% of its words are in the GPU draft') 7/15 accepted, 8/15 wrong text, P(acc >= 0.8) = 0.001. Put-back stratum 8/15 accepted, 3/15 wrong text, P = 0.007. By the pre-registered rule both strata go to read@4, none to 'apply the kept read'. Wrong-page controls 4/4 refused, planted errors 4/4 caught. In production the lane wrote 4,708 of 28,104 pages tried (16.8%) at 5.3 agy calls a written page, against 0.59 for the Latin read@4 lane."
status: rejected
decision: "Do not apply the kept reads. Keep arm C off. Pending Derek's decision: re-read the 16,877 share and put-back pages with read@4. Written here: only the 15 accepted pages of the test. Router counts refusals: #8111. Complete replies refused as exit -9: #8110."
superseded_by: null
issue: [7701, 6740, 8110, 8111]
router_evidence: [latin-blank]
defect_rates: scripts/eval/route-judge-6740/results/armc-refused-7701-2026-11-04/defect-rates.json
---
PRIOR ART: `2026-10-29-cheap-routes-7701.md` (the 18/18 written row this corrects; its harness, `cheap-routes-7701/run.mjs`, is the source of `armc-refused-7701/run.mjs`, and `judge.mjs judge` runs unchanged) and `2026-10-29-euro-armc-production-pilot-7567.md` (arm C on other languages).

## 2026-11-04 · Arm C's refused Latin reads: good text thrown away, or errors rightly caught? (#7701)

Arm C (PERO GPU draft, agy Flash-low with the image, #7695 put-back) never retries a refused page, and its router row counted only the pages it wrote. Derek paused it on 2026-11-04. This test judges the reads it kept and refused.

**Design** (rule fixed before any verdict: `route-judge-6740/results/armc-refused-7701-2026-11-04/RULE.md`, commit d9897a0).
- **Draw.** Seeded, page-weighted, one page a book across both strata, from a ledger snapshot (27,412 rows, 11:05Z). Pages unread in Mongo with a usable kept read: exit 0, no error class, no wrapper error. No shortfall: 15 + 15.
- **Judge.** Opus (`claude -p`), blind, one read at a time, against the page image from its source. It saw neither the draft nor the refusal reason.
- **Controls.** Wrong-page 4/4 refused at fidelity 1. Planted errors 4/4 caught (kinds B, C, D, E). No stratum void.
- **One call lost.** A judge call was killed at `judge.mjs`'s 900 s while queued behind the pace guard. It was retried and counted once. `ROUTE_JUDGE_WEEKLY_MAX` stayed at its default, and the pace guard was not bypassed.
- **Images.** Three of the 30 reads were made from different bytes than the judge saw: same URL and etag, same dimensions, a CDN re-encode (mean grey difference at most 0.06 of 255). The pictures are the same, so the sample stands. The CDN mechanism is inferred, not confirmed.

**Result.** Score: `route-judge-6740/results/armc-refused-7701-2026-11-04/score.json`.

| stratum | frame at draw | accepted | wrong-text pages | P(acc >= 0.8) | fidelity 3 / 4 / 5 | rule's route |
|---|---|---|---|---|---|---|
| only N% of words in the draft | 6,805 pages, 89 books | 7/15 | **8/15** | 0.001 | 8 / 5 / 2 | re-read with read@4 |
| put_back_unsafe | 9,615 pages, 95 books | 8/15 | **3/15** | 0.007 | 7 / 8 / 0 | re-read with read@4 |

Defects, pages with the class (`page-error-taxonomy.md`). Share: O6 12, O8 7, O5 4, O16 3, E2 3, O7 3, T6 2, O1, O12, O4, T5 1. Defects by severity: wrong text 29, misleads 51, cosmetic 43. Put-back: O6 13, O7 6, O8 6, E2 4, O12 3, O11, O2, O16, O14 1. By severity: wrong text 6, misleads 27, cosmetic 31.

**Defects per 1,000 words** (`defect-rates.json`, n = 15 a stratum, no recheck calibration or by-book interval; beside the k/n rule, it does not move the decision).

| route | pages | words | misleads | wrong text | fidelity |
|---|---:|---:|---:|---:|---:|
| kept, share stratum | 15 | 10,334 | 4.94 | 2.81 | 3.60 |
| kept, put-back stratum | 15 | 7,020 | 3.85 | 0.86 | 3.53 |
| `pero>agy-flash-low-written` (router table, pooled with the sampler) | 90 | 23,507 | 4.21 | 2.34 | 3.83 |
| `agy-flash-low@4-written` (router table) | 26 | 5,896 | 1.53 | 0.17 | 4.46 |

The refused reads are not clearly worse than what arm C wrote once the sampler's pages are pooled in, though those 90 pages come from only 22 books. Read@4's written pages are far cleaner than both, on other pages. Its rate on these refused pages is not measured.

**By eye: 10 pages, images in the job's scratch.** Too few to estimate a false-alarm rate; they only bound it.
- **Five rejects, five confirmed, no false alarm.** "Idem laborem" where a blue initial gives "Quem"; "si per te" for "non per te"; "proportionem" for ꝓ pctō; "hominis" for "domini"; "c. finali" for "c.j". One read has literal Chinese inside a Latin word ("vel跳转tesum").
- **Five accepts, all recognisably right, with real slips.** Signature "d ij" for printed "d iij"; "mihi" for "michi"; and "Sanctus" where the page has Vñ, accepted anyway. One possible judge miss: "nisi propter peccatum" where the abbreviation may be *per*, given fidelity 5. If the judge errs here, it errs lenient.

**Reading.** Both guards catch real errors and throw out good pages. Wrong text on these refused reads is 11/30, against 1/40 on the two tests' written pages, so the guard is doing something. But half the pages it refused were accepted, and these guards can't tell which half. The share guard refuses far more wrong text (53%) than the put-back guard (20%).

**Refused pages by route, whole ledger at lane stop** (28,104 tried, 4,708 written, 23,396 refused; 18,270 have a usable kept read, plus the 15 written):

| reason | pages | usable read | what this test says |
|---|---:|---:|---|
| only N% of words in the draft | 7,102 | 7,095 | re-read with read@4 (7 written here) |
| put-back: not like for like | 8,172 | 8,164 | re-read with read@4 (8 written here) |
| put-back: flag spans a tag | 1,618 | 1,618 | re-read with read@4 |
| corrector tags page `mixed` | 836 | 836 | not tested |
| letters outside the book's scripts | 442 | 442 | not tested |
| corrector tags page `handwritten` | 82 | 82 | not tested; print route does not fit |
| CONTAIN | 17 | 17 | not tested; check by eye |
| UNCHANGED | 10 | 10 | not tested |
| more than one header | 5 | 5 | not tested |
| corrector tags page `none` | 1 | 1 | not tested |
| no image fetched | 2,822 | 0 | no read to judge |
| GPU draft under N characters | 786 | 0 | no read to judge |
| PERO wrote no draft | 91 | 0 | no read to judge |
| reply cut, no marker, empty | 215 | 0 | no read to judge |
| `cli exit -9` | 1,155 | 0 by the rule | see below; not judged |
| `cli exit N` | 42 | 0 | no read to judge |

Totals: 16,877 go to read@4 by the rule, 1,393 have a usable read with no route from this test, 5,111 have no judged read, 15 were written.

**The lane ran past the pause.** The commented crontab line stopped new starts, not the job already running. From the 11:05Z snapshot to its end at about 12:22Z the ledger grew by 692 rows (73 written). That is why the refused count passed the brief's 22,740. The judged frame stays the snapshot.

**Cost per usable page, Latin** (subscription terms: agy calls, a call being 4.36e-6 of a $200 month by the router's $0.00087).

| lane | agy calls | pages written | calls per written page | judged accepted among written | calls per accepted page |
|---|---:|---:|---:|---:|---:|
| arm C, 10-29 to 11-04 | 25,132 (0.11 of a month) | 4,708 of 28,104 | **5.34** | 37/40 (two tests) | **5.8** |
| read@4 lane, 11-03 and 11-04, still running at count | 17,169 (0.075 of a month) | 29,329 of 36,646 rows | **0.59** | 30/37 (latin-paired) | **0.72** |
| read@4 on unread pages, latin-paired test | 0.30 a page | 37 of 40 | 0.32 | 30/37 | 0.40 |

- Caveat on the second row: the lane re-reads pages that hold Flash-Lite text under a different guard, so this is not the same frame as arm C.
- Arm C also spent about 5 to 10 hours of GPU card time for PERO drafts, from 0.65 to 1.28 s a page in the metas.
- About 20,400 of arm C's calls ended on a refused page.
- Re-reading the 16,877 costs about 5,100 to 9,900 calls, 0.02 to 0.04 of a $200 month.
- Read@4's quality on these pages is not measured. The refused pages are a selected set and may be harder, and its Latin wrong-text rate on written pages is already 5/37. It is the rule's route, not a proven one.

**Router.** `pero>agy-flash-low-written` is 18/18 (cheap routes) because a refused page is outside k/n. Over the pages DRAWN the same two tests give 37/70, 1 wrong text, now recorded as `pero>agy-flash-low-tried` in `latin-blank`, with the refused reads as `pero>agy-flash-low-kept` (15/30). Even 37/70 flatters the lane: the tests wrote 57% of drawn pages, production 16.8%, which caps accept among tried in production at 16.8% (about 15.5% times 37/40). `current.json` did not move. A test build shows that adding rows does not fix this: the cell still falls back to `pero>agy-flash-low@4-written`. The code change is #8111.

**Exit -9.** 1,155 pages in 56 books, 723 in the top 10, on 11-02 to 11-04 almost entirely. What they share is how the process ended. agy prints a whole successful reply and never exits, the wrapper kills it and keeps the reply (#7503), `cli-ocr.mjs:390` stores `exit: -9`, and apply's `m.exit !== 0` refuses it. 1,147 of the metas have no error class and 1,152 no wrapper problem, so most are complete replies thrown away by one line; 8 are real timeouts. Why 10 books hold most of them was not checked. The read@4 lane loses pages the same way (133). These reads are not judged. #8110.

**Written.** The 15 accepted pages (7 share, 8 put-back) went through `cli-ocr.mjs apply --only --first-read-only --print-only --apply`, without `--diff-guard`, no new override (runs cli-ocr-20261104122227-578136, cli-ocr-20261104122232-578484). Mongo checked: 15/15 identical to the judged text, 15 revisions, stamp `pero-agy-first-read-7701`.
- All 15 books stay held `scans-only-publish-7176`, hold untouched, so translation and later phases do not select them.
- The nightly `lane-judge-sampler` samples by that stamp, so it can draw these as the lane's written pages. They are 15 of more than 4,700.
- The arm C ledger still says refused for them; the lane does not retry either way.

**Not done here:** no read beyond the 30 pages, no re-read at scale, lane not re-enabled, crontab unchanged, untested reasons not judged, exit -9 not fixed.
