---
stage: ocr
measure: [judged]
languages: []
scripts: []
canons: []
n_books: 79
n_pages: 790
verdict: "No batched shape beats the 15-call reference under the preregistered rule: every batched arm caught 8/10 or fewer planted English defects (needs 9/10). P5-opus finds 10.1 V-confirmed serious OCR findings a book against R's 11.1, at 63% of R's quota (142.5 vs 99.0 per 1% of a week), and also reads the English."
status: rejected
decision: "R stays (prereg §7 rule). Sensitivity: page_defect is an English-layer control that R itself would fail (R reads no English). If it is scored as translation scope, P5-opus wins on OCR per quota (+44%) at the same recall and higher precision. Adopting P5-opus as paired-fifths-check v2 is a DECISION for Derek, not made here."
feeds: judge
superseded_by: null
issue: [8478, 8405]
router_evidence: "none — no route compared"
defect_rates: "none — judge findings and verifier confirmations on 79 books drawn from the #7866/#8405 frame, not corpus defect rates"
---
## 2026-11-09 · Book check call shape: 10 pages in one call, or one call per pair, against the 15-call reference. Results (#8478)

Preregistration: `2026-11-09-callshape-prereg-8478.md`, §1–6 plus §7 (quota rule, OCR vs translation; Derek's 19:07Z and 19:14Z comments, written before any result was read) and §8 (page_defect matcher fix, after 3 of 10 page_defect units). No other rule changed.
Code: `scripts/eval/callshape-8478/run.mjs`. Output: `scripts/eval/callshape-8478/results/{score.json,books.json,frame-summary.json,eye-report.md}`. Verdicts are in `$JOB_SCRATCH/callshape-8478/` on the job host. Nothing was written to `book_checks` or to page text.

### Run
- **Frame:** 160 #8405 books → 130 eligible (23 without five complete pairs, 7 whose served text hash changed since #8405, after the #8425 repairs). Seeded draw: 80 study books, 30 control books (10 per kind; page_defect plants: 6 numeral, 3 negation removed, 1 negation added).
- **Complete:** 79 of 80 study books in all four arms and V (≥ 40, so the decision stands). 110 units framed.
- **Calls:** 1,195 `claude -p` calls (subscription, team@, concurrency 3; 7 of them failed), under the 2,000 cap. The pace guard was not bypassed.
- **Quota:** team@ weekly went from 50% (19:15Z) to 76% (23:52Z), **Δ26% of a week**, for 48.4M price-weighted tokens (0.537% of a week per M weighted tokens). Other team@ use in that window inflates the delta. The token shares between arms hold regardless.

### Controls
| arm | carry_over | wrong_leaf | page_defect (§8) | page_defect strict | valid |
|---|---|---|---|---|---|
| B10-opus | 10/10 | 10/10 | **8/10** | 7/10 | no |
| B10-sonnet | **7/10** | 10/10 | **8/10** | 7/10 | no |
| P5-opus | 10/10 | 10/10 | **8/10** | 7/10 | no |
| P5-sonnet | **8/10** | 10/10 | **7/10** | 6/10 | no |
| R (#8405) | 10/10 | 10/10 | n/a (reads no English) | n/a | yes |
| V | confirmed 149/150 planted findings raised | | | | yes |

Both Opus page_defect misses are the same two plants, and all four arms missed them. In one (Latin, `69dbc99f…`) the removed "not" translates a "non" in the source, so the plant was a real defect and every arm missed it. In the other (Greek, `69a5e3d7…`) the plant inserted "not" into a sentence whose source "ἆρά γε" has no negation to lose. That made a defect, but a subtle one. Dropping the Greek plant as unfair gives 8/9 = 0.89, still under 0.9, so the decision does not change. Sonnet's carry-over misses are on Sanskrit (`69dea5f8`), Latin (`6970e375`) and Tibetan (`6abedf77`, B10-sonnet only).

### Results (79 books; per book, V-confirmed, counted once per `same_as` cluster)
| arm | calls/bk | serious OCR/bk [95% CI] | OCR recall vs union | OCR precision | books per 1% week | **serious OCR per 1% week** | serious translation/bk | translation per 1% week |
|---|---|---|---|---|---|---|---|---|
| R | 15 | **11.11** [7.94, 14.84] | 0.712 | 0.916 | 8.9 | 99.0 | 0 (by design) | 0 |
| P5-opus | 5 | 10.08 [7.32, 13.32] | 0.705 | **0.963** | 14.1 | **142.5** | **11.87** | 167.9 |
| P5-sonnet | 5 | 5.19 [3.66, 6.91] | 0.382 | 0.909 | 26.7 | 138.4 | 7.68 | 204.9 |
| B10-opus | 1 | 7.34 [5.44, 9.48] | 0.539 | 0.957 | 18.4 | 135.2 | 9.71 | 178.8 |
| B10-sonnet | 1 | 3.76 [2.72, 5.04] | 0.280 | 0.924 | 29.9 | 112.5 | 4.70 | 140.6 |

Union of all arms: 14.3 serious OCR and 13.8 serious translation findings a book. Weighted tokens a book: R 209K, P5-opus 132K, B10-opus 101K, P5-sonnet 70K, B10-sonnet 62K, and V 103K. No arm's OCR precision is more than 10 points below R's, so none needs V under rule 2. Book verdict agreement with R (paired rule): B10-opus 0.67, B10-sonnet 0.79, P5-opus 0.66, P5-sonnet 0.65. R calls 43 of 79 books bad, while P5-opus calls 58 and B10-opus 61. The batched arms read the English, so they find more English-layer defects that sink a book.

**Frontier (serious OCR per book vs books per 1% of a week):** R (11.1, 8.9), P5-opus (10.1, 14.1), B10-opus (7.3, 18.4), P5-sonnet (5.2, 26.7), B10-sonnet (3.8, 29.9). Every arm is on it. Above P5-opus the extra recall costs a lot: R buys one more serious OCR finding a book for 59% more quota. Sonnet doubles throughput but loses half the recall and the carry-over control.

### Decision per the preregistered rule (§7)
1. Eligible (≥ 9/10 every control kind): **none of the batched arms.**
2. –
3. –
4. **R stays.** The §6 per-book rule, reported for comparison, also gives R stays.

**Sensitivity (not the rule).** page_defect plants an error in the English. R's page judge never reads the English, so R would score 0/10 on it. The §7 amendment moved English findings out of the decision and into a separate translation measure, but it left this control in the validity gate. Read in the spirit of §7, the control belongs on the translation side. Then the Opus arms are valid (carry_over and wrong_leaf 10/10), and **P5-opus wins on serious OCR per 1% of a week (142.5 vs 99.0, +44%)**. It does so at about the same recall (0.705 vs 0.712 of the union; per book 10.1 vs 11.1, CIs overlapping), with higher precision (0.963 vs 0.916), and it adds 11.9 serious translation findings a book that R does not look for. B10-opus is valid in that reading too but finds 34% fewer serious OCR findings a book than R. That choice is a judgment call about the gate, so it goes to Derek and is not taken here.

### By eye (Opus reader with both scans open; `results/eye-report.md`)
- **10 V-confirmed findings raised only by a batched arm:** all 10 true (3 serious, 4 moderate, 3 minor). By arm: P5-opus 4, B10-opus 3, P5-sonnet 2, B10-sonnet 1.
- **10 V-rejected findings:** V right 6, wrong 3, half-right 1. The three V got wrong: B10-sonnet's Greek OCR misreads with an invented opening; R's Latin "Hec" for "Aue" (English "This Mary"); R's German blank leaf whose transcription warns of "~40 lines of faded script". V therefore under-confirms a little, which makes the confirmed counts above conservative for every arm alike.
- Also seen: a real 訝→訶 misread on a Chinese page nobody flagged, and about 10 missing leaves between pp. 9/10 (f.362v → f.372r) of a Latin book.

### Containment (`containment-on-finding.md`, #8494, label `contained`)
- Greek `699383b350654cbbe29181eb` p. 60: the opening OCR lines are not on the leaf, and the English translates them. Withheld under hold `invented-text-by-eye-8478`.
- Chinese `6a3c634a4daf85677d170c3e` p. 86: the English opens with an entry ("Broken Joy (突悅)", "The book is incomplete") that is not on the leaf. p. 85: the English is built on a spine-label misread (御定佩文韻府 → 甲定風文類存). Both withheld under the same hold.
- German `6a49137aac0c339f55337966` p. 2: a blank endpaper whose transcription carries an invented warning. Noted in #8494 and not contained, because it has no English. The re-read and re-translate repairs are owed in #8494.

### What this means for the standing check
The real question this test answers is whether the check should read the English. R cannot see a mid-page mistranslation at all, and the union holds as many serious translation findings (13.8 a book) as OCR ones (14.3). P5-opus gives close to R's OCR recall for 63% of its quota and covers the translation too. B10 loses too much OCR recall, and Sonnet loses recall and the carry-over control in both shapes. A v2 of `paired-fifths-check` on P5-opus needs a translation-side control set (the page_defect plants, with the two unfair ones replaced) and a follow-up PR to the method doc. Neither is made here.
