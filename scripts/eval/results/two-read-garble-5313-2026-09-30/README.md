# Does a second read of the page find garbled OCR? (#5313, #5376)

PRIOR ART: `scripts/eval/results/garble-detector-5313-2026-09-30/` (PR #5369) scored one-read text signals against the same judged pages: precision 0.60, recall 0.09, gate not met. `scripts/eval/revision-agreement-*.mjs` (#3235) use `page_revisions` as a stability corpus and never score it against a garble label. `scripts/eval/results/leaf-identity-2026-09-30/` (#5311) found six wrong-leaf pages by eye; they are reused here as known positives for a different defect.

**Why.** Readers get a caution note on 1.08% of pages (#5315), but the corpus audit's judge flags about 6.6% of served pages as garbled OCR rendered as confident English. Word-level checks cannot find those pages, because a misread produces plausible words. The question here is whether *disagreement between two independent reads of the same image* can.

**Answer, in four lines.**

1. **Existing double reads do not cover the corpus and cannot be scored.** Only 14 of the 327 reference pages have an earlier model read in `page_revisions`, and none of the 32 garbled ones. The Internet Archive's own OCR covers more pages but disagrees with ours on clean pages too. Neither is a usable second read.
2. **A fresh second read carries a real signal, but not a precise one.** It ranks garbled pages well (AUC 0.80–0.86; 0.87–0.91 on major garble) and reaches most of them (recall 0.6–0.9, against 0.09 for the text signals). Precision against the judge stays at 0.3–0.45 at every threshold. The 0.8 gate in #5313 is **not met**, so no field is written and the reader is unchanged.
3. **The 0.8 gate cannot be met on this reference by any detector.** A second judgment of the same OCR text reproduces the audit's garble flag at precision 0.51–0.58 and recall 0.62–0.66. By eye, the flagged "hard pages" have an unreliable served text on 8 of 18 (44%), and at least minor errors on all 18.
4. **The same two reads separate wrong-leaf pages cleanly.** All six pages #5311 found by eye, plus a seventh in a book that study never sampled, have the signature "two fresh reads agree with each other, and neither agrees with the served text". No page read by eye as a match carries it.

Nothing here writes to `pages`, a queue, or any store a job reads. Cost: $1.64 on the Batch API.

## What was measured

**Reference.** 327 pages, one per book, from the corpus audit (#5274) and its first monthly run (#5319). A page is *garbled* when the Opus judge set `garble_passthrough`: 32 pages, 15 of them major. This is the same reference PR #5369 used. `measure: judged` — the judge read the OCR beside the translation and never opened an image.

**The score.** Agreement between the served OCR text and a second read: the script-aware token ratio from `scripts/lib/ia-ocr-agreement.mjs` (characters for space-less scripts, words elsewhere), over the transcribed body only. A page with fewer than 30 tokens on either side is *unjudged*, never "disagreeing". `measure: agreement` — a screening signal under `.claude/docs/eval-design.md` §2, not accuracy.

**Three sources of a second read.**

| Second read | Pages with one | Judged | Garbled pages judged | Result |
|---|---:|---:|---:|---|
| Earlier model read in `page_revisions` | 14 of 327 | 13 | 0 of 32 | unjudged: no positive to score |
| Internet Archive's own OCR (`_djvu.xml`) | 162 | 122 | 7 | clean pages agree at only 0.55 (median); precision 0.06–0.14 |
| Fresh lite read (pilot) | 321 | 288 | 27 | AUC 0.80; at ratio < 0.7: precision 0.29, recall 0.74 |
| Fresh flash read (pilot) | 321 | 301 | 30 | AUC 0.85; at ratio < 0.7: precision 0.30, recall 0.70 |

The six wrong-leaf pages are left out of the garble scoring (their served text is another page, which is a different defect) and reported separately below. The Archive's per-word confidence, where present, does not separate garbled pages either (AUC 0.60–0.63 on 6 positives).

**The pilot.** Each reference page was read three times from the image the reader is shown (`display_photo`), resized to 1500 px, under the live default OCR prompt (Standard OCR v16) with the pipeline's settings (temperature 0.1, thinking off): `gemini-3.1-flash-lite` twice and `gemini-3-flash-preview` once. 981 requests through the Batch API from Hetzner. Outcomes: 920 text, 34 refusals, 26 truncated at the output cap, 1 error. Refusals and truncations are failed reads and leave the page unjudged.

## Reading the three reads together

With two fresh reads a flagged page falls into one of two groups, and they mean different things. Thresholds: the served text *agrees* when its ratio against the better fresh read is at least 0.7; the fresh reads *agree with each other* at 0.8 or more. These were fixed after the judged sweep was read and before any image was opened, so they are in-sample against the judge.

| Class | Pages | Judge: garbled (major) | Any of 4 judgments garbled | Wrong leaf by eye (#5311) | Latin / non-Latin script |
|---|---:|---:|---:|---:|---|
| Served text agrees with a fresh read | 229 | 8 (2) | 22 | 0 | 158 / 71 |
| **Hard page** — every read disagrees with every other | 47 | 19 (11) | 27 | 0 | 10 / 37 |
| **Served text is the outlier** — fresh reads agree, served does not | 12 | 0 | 0 | 6 | 11 / 1 |
| Unjudged (a fresh read refused, looped or was too short) | 39 | 5 (2) | 10 | 0 | 20 / 19 |

- **Hard page** as a garble flag: precision 0.40 against the audit flag (19 of 47), 0.57 if any of the four judgments counts; recall 0.70 of the judged garbled pages (19 of 27) and 0.85 of the major ones (11 of 13). Against all 32 garbled pages, including those with no usable second read, recall is 0.59.
- **Garble is a non-Latin-script problem in this sample**: 24 of the 30 judged garbled pages. On Latin-script pages agreement does not separate garbled from clean (median 0.90 against 0.93 for flash; precision about 0.1).
- **The two lite reads against each other** (the repeat-noise arm) agree perfectly on clean pages (median 1.00) and less on garbled ones (0.88): instability alone has AUC 0.84, precision 0.46 and recall 0.34 at ratio < 0.7.

## How good is the judge's label?

The paired-arm study (#5372) had the same judge rate three new translations of the same OCR text for 304 of these pages. Scoring each of those judgments as if it were a detector of the audit's flag:

| Re-judgment | Precision | Recall |
|---|---:|---:|
| arm L1 | 0.51 | 0.62 |
| arm L2 | 0.58 | 0.66 |
| arm F | 0.56 | 0.66 |

The flag also depends on the translation, which differed between arms, so this overstates pure label noise. It still bounds what any detector can be *shown* to do on this reference: a precision of 0.8 against a label that reproduces itself at 0.55 is not reachable. The same applies to the result in PR #5369.

## By eye: what the flagged pages are

Thirty pages went to three blind readers (Opus subagents): 20 drawn at random from the 47 hard pages, the 6 outlier pages not already read for #5311, and 4 clean controls. Each page showed the image and the three reads in shuffled order as A, B, C, with no judge label and no class. Every verdict is labelled *read from image*; "cannot tell" was a permitted answer and was used 7 times. Thirteen images were only partly legible to the reader and two poorly, so these are careful reads, not ground truth.

| Group | Pages | Served text materially wrong | Served text otherwise |
|---|---:|---|---|
| Controls | 4 | 0 of 4 | 3 faithful, 1 minor |
| Hard pages | 20 | **8 of 18 judged (44%, 95% CI 25–66%)**; 2 cannot tell | 10 minor, 0 faithful |
| · judge said garbled | 9 | 5 of 9 | 4 minor |
| · judge said clean | 11 | 3 of 9; 2 cannot tell | 6 minor |
| Outlier pages | 6 | 1 of 6 (a different page) | 3 faithful, 2 minor |

"Materially wrong" means unreliable, a large part missing or added, or another page's text.

- The judge and the eye agree only weakly: three pages the judge passed are unreliable against the image, and four it flagged are only slightly off.
- No hard page has a faithful served text. The flag is right that these pages have errors; it cannot say how bad.
- **On hard pages flash reads better than the served text, and lite reads worse.** Flash was unreliable on 6 of 17 judged, the served text on 8 of 18, lite on 15 of 18 (one of them fluent text that is not on the page). A fresh read was good on 4 of the 8 pages whose served text is unreliable. So a flash re-read would repair about half of them; the rest are unreliable under every read we have and need a specialist lane or a note.
- The five mild outlier pages (served ratio 0.60–0.65) are not defects: the served text keeps the printed abbreviations and long s, and the current prompt expands them.

## Wrong-leaf pages

The signature is *served text against the better fresh read below 0.3, and the two fresh reads against each other at 0.9 or more*. Seven pages carry it:

- the six pages #5311 found by eye (served 0.14–0.21, fresh reads 0.97–1.00);
- [Calderón, *La vida es sueño*, page 36](https://sourcelibrary.org/book/69e41216937ee36cf27c7554?page=36), from the monthly sample, which #5311 did not cover. *Read from image, display and source leaf both opened*: both show the page beginning "que es esta que ciño"; the served text is the page before. Text lane, offset one leaf, `pipeline_preview` OCR from April 2026 (`eye/arbitration.md`).

None of the 292 pages #5311 read as a match carries the signature. A single lite read also scores all six known pages below 0.21, so one read finds candidates and a second is needed only to confirm. This is a verification instrument for #5309, which works from the text and on any provider.

## Coverage, and what covering the corpus would cost

Measured on Atlas, 2026-09-30 (`coverage.json`). Live means `visible && pages_count > 0`; page totals are the books' own counters.

- Live corpus: 42,189 books, 4,628,175 translated pages. Internet Archive books hold 59% of them.
- Pages with any earlier model read in `page_revisions`: 428,511 in live books, at most 7.4% of OCR'd pages and 9.3% of translated ones. This is an upper bound: it counts byte-identical snapshots and pairs from different leaves, and the list of sources omitted `bdrc` (103,440 rows from the Tibetan lane).
- In the reference sample, 4% of pages had a usable earlier read and 37% a usable Archive read.

Cost of a fresh read, from what the pilot was billed per request on the Batch API, refusals and loops included (`report.json` → `cost_to_cover`): lite $0.0011 per Latin-script page and $0.0020 per non-Latin page; flash $0.0020 and $0.0024.

| Plan | Non-Latin translated pages (817,558) | Every live translated page (4,628,175) |
|---|---:|---:|
| One lite read | $1,641 | $6,618 |
| Two lite reads | $3,268 | $13,198 |
| Lite + flash (the class split above) | $3,624 | $16,609 |
| Wrong-leaf check: 3 pages in each of 23,662 Archive books, one lite read | — | about $75 |

Page counts by script come from the monthly audit's frame (15 languages, 4.31M translated pages). The all-pages column uses the pooled pilot rate, which leans high because the sample over-represents non-Latin pages. None of these was run; all are above the spend floor.

**Is a sample enough?** It depends on the use.
- For a per-page reader note: no. A page that was not re-read cannot be flagged. The only stratum where the flag works is non-Latin script.
- For wrong-leaf books: yes. The shift runs through a stretch of a book, so a few pages per book find it.
- For monitoring: yes. Two fresh reads on the monthly audit's ~100 pages cost about $0.40 and give a hard-page rate and a wrong-leaf rate that do not depend on the judge.

## Limits

- One page per book, 327 books, 32 positives. Thresholds were chosen on this sample; nothing here is a held-out result.
- The by-eye sample is 18 judged hard pages, read by model subagents, many from partly legible images. It is below the 20 hand-read members `eval-design.md` §6 asks for before a rate is quoted, so the 44% is an indication, not a rate.
- The second reads used the current prompt; most served text was written under older prompts. Some disagreement is convention, not error (the mild outlier pages show this).
- Two reads that both recite a memorised text agree with each other. Agreement cannot see that class.
- One flash request returned an error and was not retried; that page is unjudged in the flash comparisons.
- No corpus run was made, so no corpus count of flagged pages exists.

## Files

- `reference.jsonl` — the 327 pages, the judge's flag, the #5372 re-judgments, the #5311 leaf verdict.
- `pages-live.jsonl`, `reads-revisions.jsonl` — live page facts and every earlier OCR text for those pages.
- `reads-ia.jsonl` — the Archive's text for the leaf and its two neighbours each side, with word confidence.
- `pilot-arms.json`, `pilot-sample.jsonl`, `pilot-batch.json`, `reads-pilot.jsonl` — the pilot's settings, image and prompt hashes, job record with cost, and the 981 reads.
- `scores.jsonl`, `report.json` — one row per page and comparison; the full sweep per label, the classes, the judge's self-agreement, cost to cover.
- `coverage.json` — corpus coverage.
- `eye/` — the blind packet (`page-NN.md`), its key, the readers' verdicts, the joined table and report, and the one arbitration. Page images are not committed; `eye-packet` re-downloads them.

## Reproduce

```
A=scripts/eval/results
node scripts/eval/two-read-garble-5313.mjs reference --audit=$A/translation-corpus-audit-2026-09-30 --audit=$A/translation-corpus-audit-monthly-2026-09 \
  --paired=$A/translation-paired-arm-2026-09-30 --leaf=$A/leaf-identity-2026-09-30
node --env-file=.env.production.local scripts/eval/two-read-garble-5313.mjs revisions   # Mongo, read-only
node scripts/eval/two-read-garble-5313.mjs ia                                           # archive.org; run on Hetzner
node --env-file=.env.production.local scripts/eval/two-read-garble-5313.mjs coverage    # Mongo, read-only, several minutes
node scripts/eval/two-read-garble-5313.mjs score --frame=$A/translation-corpus-audit-monthly-2026-09/draw-log.json
node scripts/eval/two-read-garble-5313.mjs eye-packet --images=<dir outside the repo>
node scripts/eval/two-read-garble-5313.mjs eye-score
```

`--paired` needs the results directory from PR #5372; the votes are already stored in `reference.jsonl`. The pilot stages (`pilot-draw`, `pilot-submit --approved-usd=N`, `pilot-collect`) are paid and were run once; `pilot-submit` refuses to run again while `pilot-batch.json` exists.
