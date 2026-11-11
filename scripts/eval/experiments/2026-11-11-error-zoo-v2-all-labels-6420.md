---
stage: ocr
measure: [judged]
languages: [la, grc, de, fr, it, nl, ar, he, fa, zh, lzh, bo, sa]
scripts: [Latn, Grek, Arab, Hebr, Hani, Tibt, Deva]
canons: []
n_books: 3245
n_pages: 10805
status: undecided
feeds: [detector, figure]
superseded_by: null
verdict: "Every page-level judgment we hold is 12,352 rows from four stores, seven times the first pass; the predictor trained on all of them scores AUC 0.815 out-of-book pooled, 0.76 on the weekly audit's uniform draw (0.72 trained on that draw alone, replicating the first pass without image features). On the uniform draw the top 10% by risk is 74% serious against a 31% base and the top 30% holds 59% of the serious pages; the brief's '5% hold a third' is NOT reached (5% hold 14%). Lane B's own check agrees with the independent Opus audit on 46% of 250 shared pages. The '59% unclassed' errors are minor and moderate: 95% of serious findings were already classed."
decision: "Nothing run on production. Four defaults wait on #6420: aim half the weekly audit at the top risk decile; run the paired before/after on the next lane-B batch; record audit labels into book_checks; a Flash-Lite screener or GPU second read stays off until Derek says."
---

PRIOR ART: `scripts/eval/error-zoo/README.md` (PR #8608, the first pass: 1,520 pages, one reader, AUC 0.72);
`2026-10-11-invented-text-qualitative-recheck-6420.md` (the kinds); `2026-10-13-ocr-opus-correct-vs-lane-b-q300-6694.md`
(the only paired judgment of lane B so far); `.claude/docs/measurement-validity.md`.

## 2026-11-11 · Error zoo v2: all label sources, per-source predictor, the unclassed tail (#6420)

**Who reads this.** Whoever aims the next audit or repair budget, and Derek deciding the four defaults below.

### What was built (scripts in `scripts/eval/error-zoo/`, outputs on gex45-1 under `/root/jobs/error-zoo-v2/`)

| step | script | output |
|---|---|---|
| gather every page-level label | `labels.mjs` | `labels.jsonl`, 12,352 rows: book_checks 10,118 (1,171 stale: text changed since the judgment), weekly audit on disk 1,778, served-arm lane judge 218, applied corrections 238 (positives only) |
| live text + neighbour seams + book facts | `fetch-pages.mjs` | `pages.jsonl`, 11,438 pages, 3,416 books |
| features | `features.py` | 199 features: 121 difficulty (year, language, model family, prompt, script, provider, book class), 78 text (size, repetition, garbage, lexicality, script block, OCR↔English consistency, self-tags, 12 neighbour-seam) |
| train + report | `train.py` | `predictor-report.md`, `preds.jsonl` |
| class the unclassed tail | `classify-unclassed.py`, `run-batches.sh` | `classes/classes.jsonl`, `classes/spotcheck.md` |
| the zoo from all sources | `zoo-all.py` + `head.html`/`tail.html` | https://claude.ai/artifact/5JkkHvq7mnsmkJDqaHxUPK (republished) |
| before/after for lane B | `LANE-B-BEFORE-AFTER.md` | a plan; nothing run |

### 1. The labels: what exists, and what they agree on

| store | pages | serious | reader | how drawn |
|---|---|---|---|---|
| `book_checks.page_findings`, fresh text | 8,947 | 45% | 19 methods; Gemini Flash for `ocr-convergence` (2,933), Opus/Claude for the rest | random WITHIN picked frames (most-read books, lane queues, repairs) |
| weekly audit (`/root/jobs/spare-audit`, 23 rounds) | 1,778 | 35% (random stratum 31%, lane-B-written 47%) | Opus, #6338 brief | uniform over visible non-English books, one page per book, plus 20 lane-B pages a round |
| `lane_judge_verdicts`, served arm | 218 | 74% | Opus | test cells |
| `page_corrections` applied | 238 | 100% | human or job, image read | picked |

- **The same reader is consistent; different instruments are not.** The weekly audit read 128 pages twice (lane-B
  pages recur in the draw): the same Opus verdict on 122 (95%). Lane B's own check (`ocr-convergence`, Gemini Flash
  reader) and the Opus audit read 250 of the same pages: they agree on **46%**, below what two readers at these base
  rates would agree on by chance. Most of the disagreement is Gemini-clean / Opus-serious (104 of the 203 fresh
  pairs). A lane cannot be measured by the instrument that chose its writes; this is the number behind the lane-B plan.
- **Stale labels are common.** 1,171 of the 10,118 book_checks page labels are of text that has since been rewritten
  (lane B's gate run judged pre-repair text). They are kept in the table with `stale: ocr|translation` and held out of
  training; a label is of a `text_sha`, not of a page.
- **The "59% unclassed" of the first pass are the minor ones.** 13,953 findings in the audit: 1,645 serious, of which
  **95% carry a class**; 5,582 minor and 2,128 moderate findings mostly do not. The zoo already covered what harms
  readers. In book_checks 1,859 findings used legacy strings (`ocr-misread`, `ocr-unsettled`, `wrong_leaf`) that map
  one-to-one onto O6 / I1.

### 2. The predictor (GroupKFold by book; `predictor-report.md` has every table)

| frame | n | base | AUC | prec@10% | prec@30% | catch@30% |
|---|---|---|---|---|---|---|
| pooled, all trainable rows | 10,805 | 44% | 0.815 | 95% | 80% | 55% |
| book_checks | 8,819 | 45% | 0.830 | 95% | 83% | 56% |
| weekly audit (all strata) | 1,768 | 35% | 0.715 | 73% | 60% | 51% |
| **weekly audit, random stratum, served (the library-wide frame)** | **1,250** | **31%** | **0.764** | **74%** | **61%** | **59%** |

The library-wide frame, which is the only draw uniform over the library and so the only one to quote:

| top share by risk | pages | serious among them (Wilson 95%) | share of all serious pages caught |
|---|---|---|---|
| 5% | 62 | 87% [77, 93] | 14% |
| 10% | 125 | 74% [65, 81] | 23% |
| 20% | 250 | 65% [59, 71] | 42% |
| 30% | 375 | 61% [56, 66] | 59% |
| 50% | 625 | 49% [45, 53] | 78% |

So: **the top 5% of pages hold 14% of the serious errors, not a third; the top 20% hold 42%, the top 30% hold 59%.**
Aiming a reader at the top decile makes 3 of 4 pages read a hit instead of 1 in 3.

- *Per-source training and transfer.* Trained on the weekly audit alone: 0.725 (the first pass's 0.72 without any
  image features, so the image block was not carrying anything). Trained on every other source and tested on the audit:
  0.640. Trained on Opus-read labels, tested on Gemini-read: 0.801; the reverse 0.718. The instruments disagree enough
  that a model fit to one reader loses 0.08 to 0.1 AUC on another.
- *Hard page or wrong text.* Difficulty block alone 0.780; text block alone 0.778; both 0.815; the 12 seam features
  alone 0.657. Year is the single strongest feature (oldest fifth 77% serious, newest 29%). The two blocks are
  nearly interchangeable, which is the first pass's "saturation" seen from the other side: most of what either block
  measures is population. The text block is the one that can move when a page is repaired, so it is the one the
  lane-B plan scores before and after.
- *Corrections as a check.* Of 238 pages someone corrected after reading the image, 55% score in the top 30% of the
  pooled scale, 19% in the top 10%: corrections come from readers of specific books, not from the risk tail.
- *What makes the pooled 0.815 flatter than it looks.* `paired-fifths-check` (2,927 pages, 67% serious) and
  `ocr-convergence` are whole-population frames the model can recognise from provider, prompt version and quality
  score. prec@10% of 95% pooled is "the model knows which frame a page came from"; the 74% on the uniform frame is
  the honest figure.

### 3. The unclassed tail

10,746 findings carried no taxonomy code (10,193 of them minor or moderate audit findings, 553 serious book_checks
findings with no class at all). All were classed, cheaply, in three passes (`classify-unclassed.py`):

| pass | findings | what |
|---|---|---|
| legacy strings | 1,859 | `ocr-misread` → O6, `ocr-unsettled` → O6, `wrong_leaf` / `ocr-wrong-leaf` → I1, 23 `other:` strings by hand |
| keyword rules over the reviewer's prose | 7,167 | stage-scoped regexes, specific before general; a first version also matched the quoted page text and classed 4,000 translation findings as "silent normalisation" because the quotes held long s and ligatures, which the calibration sample caught |
| haiku, `claude -p`, 40 findings a call | 1,720 | the 44 class names plus a one-line guide per common class; job quota, about 60 calls |

- **Calibration.** 400 rule-classed findings were also sent to the model: exact agreement **68%**, same lane 93%.
  The rules that disagreed most (T5, T7, T10, T16, the format-as-O9 rule) were narrowed or dropped, and their items
  sent to the model.
- **By eye, 30 items** (`spotcheck-2026-11-11.md`; 10 rule/legacy, 20 model): **25 ok, 3 wrong, 2 unclear**. Both
  rule misses were one phrase (`long s read as f` classed O8 instead of O6); that rule was fixed and the items re-sent.
  The model's one miss put a note that misquotes its own Latin under O5 instead of T10. So the minor/moderate counts in
  the zoo carry roughly a one-in-six class error; the serious counts are 95% reader-classed and unaffected.
- **What the tail is made of** (after classing): O6 misreads and T8 sense slips dominate, then O8 silent
  normalisation, T9 quiet omissions, O5 OCR omissions, T7 fluent-over-garble and T10 added gloss. Nothing new: the
  minor tail has the same shape as the serious head, at lower stakes. No class outside the 44 was needed; the
  `other:` strings the reader coined (ditto marks, headword shifts, column interleave) all fold into O6 / O9 / T8.

### 4. Decisions waiting on Derek (defaults in brackets; none taken)

1. **Aim half the weekly audit by risk** [default: yes — 40 random + 40 from the top decile of `preds.jsonl`'s
   scale, stratum recorded in `draw.json`; the random half keeps the series honest; no new spend, the audit already
   reads 80 pages a round].
2. **Paired before/after on the next lane-B batch** per `LANE-B-BEFORE-AFTER.md` [default: yes — 120 books, Opus
   judge on the subscription, the #6694 stop rule].
3. **Record the weekly audit's labels into `book_checks`** with `recordBookCheck()` [default: yes — `reader_warning:
   false`, so no reader-facing warning derives from one reader; the next retrain then needs no disk walk].
4. **Signals that spend money** — a Flash-Lite yes/no screener as a feature (~$0.002 a page over 1.3M live pages
   ≈ $2,600), a Paddle second read on the GPU [default: NO until the free two-read signal from `double_ocr_pages`
   (163K pages already read twice) has been joined and measured; that is the next slice].

### Limits

- One reader for the uniform frame (Opus; Gemini never read the 23 rounds). Its serious labels are self-consistent
  (95% on repeats) but uncalibrated against a human. The `by-eye` book_checks methods total 33 pages.
- No image features for the DB-wide table; the audit pages show they add nothing measurable, but that was one reader.
- The model is not deployed and scores nothing live. `preds.jsonl` holds out-of-book scores for the labelled pages only.
- CPU on gex45-1 was kept to four threads at nice 10; no GPU, no paid API; the classification pass used the job's
  Claude quota (about 60 haiku calls, 40 findings each).
