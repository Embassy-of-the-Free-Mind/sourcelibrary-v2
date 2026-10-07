# OCR prompt v19.1: result (#4195)

PRIOR ART: scripts/eval/RESULTS-ocr-v19-showthrough.md (the run this extends; same pages, labels, request and scorer).

Spec: `PREREGISTRATION-ocr-v19-1-stamps.md`, plus Amendment 1, which was written before any v19.1 request was built. Runner: `ocr-v19-ab.mjs --v191-*`. Numbers: `results/ocr-v19-1-2026-10.json`. New reads: `results/ocr-v19-1-2026-10/reads.jsonl.gz`. Arms A, A2, B and C are the v19 run's reads, reused and not re-run.

## Recommendation, by the pre-registered rule: **v19.1**
- **v19.1 (D) passes all five clauses.** It does so against the contemporaneous control A3, which the drift rule selected, and also against A.
- **It is not worse than v18 on W ∪ T.** D beats B on 15 pages and loses on 4 (p 0.019).
- **The cost is on real pages.** D calls real pages blank more often than v18 does: 0.360 vs 0.299, worse on 8 pages and better on 0 (p 0.008). The guard is set against v16, not v18, so this does not gate. It is the trade Derek is choosing.
- **The new bullet did not do the narrow job it was written for.** Stamp words reach the body no more often under v19.1 than under v19. About half of D's recovery on the stamp leaves comes from reading the mirror-reversed page again.
- The promote is Derek's call. This run wrote no `prompts` row and nothing to `pages`.

## Design, as run
- **Pages.** The v19 run's 195 pages: W 31, T 38, S3 88, S5 38. The labels are unchanged.
- **Images.** Re-fetched, and all 195 are byte-identical to the v19 run's (image hash).
- **Request.** `gemini-3.1-flash-lite` via Batch, using the production request, k = 3.
- **New arms.** D = v19.1 (`standard-ocr-v19-1-candidate.md`, md5 `9d8f959e…`). A3 = v16, the DB row, md5 `0203c264…`; its sent prompt hash is identical to A's.
- **Size.** 1,170 requests.
- **Outcomes per arm.** D: 571 text, 11 truncated, 2 refused, 1 error. A3: 562 text, 21 truncated, 2 refused.

## Drift check (A3 vs A)
| stratum | pages | A vs A3 differ | A vs A2 differ (v19 run) |
|---|---:|---:|---:|
| W | 31 | 4 | 3 |
| T | 38 | 5 | 4 |
| S3 | 88 | 5 | 4 |
| S5 | 38 | 6 | 4 |
| all | 195 | **20 (10.3%)** | 15 (7.7%) |

- The share is over the 10% line by one page, so D was scored against A3, as pre-registered.
- No stratum's mean moved materially. A → A3: W .914 → .893, T .675 → .640, S3 .322 → .318, S5 .102 → .109.
- The verdict is the same against either baseline.

## Results
Each cell is the page mean over k = 3. "b/w/t" counts pages against v16 (A) that move by at least the page threshold: the A-vs-A2 p90, or 1/3 when that is 0.

| stratum | outcome | n | v16 A | v16 again A2 | v16 now A3 | v18 B | v19 C | **v19.1 D** |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| W ∪ T | fabricated ↓ | 69 | .783 | .780 | .754 | .435 | .348 | **.304** |
| W | fabricated ↓ | 31 | .914 | .882 | .893 | .290 | .215 | **.194** |
| T | fabricated ↓ | 38 | .675 | .697 | .640 | .553 | .456 | **.395** |
| S3 | false blank ↓ | 88 | .322 | .318 | .318 | .299 | .381 | **.360** |
| S5 | windowed CER ↓ | 38 | .102 | .102 | .109 | .117 | .137 | **.120** |

| stratum | A2 vs A b/w/t, p | A3 vs A | B vs A | C vs A | **D vs A** | **D vs A3 (gating)** |
|---|---|---|---|---|---|---|
| W ∪ T | 4/3/62, 1 | 6/3/60, .51 | 29/0/40, 4e-9 | 36/1/32, 5e-10 | **39/0/30, 4e-12** | **37/0/32, 1.5e-11** |
| W | 3/0/28, .25 | 3/1/27, .63 | 22/0/9, 5e-7 | 25/0/6, 6e-8 | 25/0/6, 6e-8 | 24/0/7, 1.2e-7 |
| T | 1/3/34, .63 | 3/2/33, 1 | 7/0/31, .016 | 11/1/26, .006 | **14/0/24, 1.2e-4** | **13/0/25, 2.4e-4** |
| S3 | 2/2/84, 1 | 3/2/83, 1 | 7/5/76, .77 | 6/13/69, .17 | 6/10/72, .45 | 6/10/72, .45 |
| S5 | 2/2/34, 1 | 3/3/32, 1 | 7/12/19, .36 | 9/14/15, .40 | 8/12/18, .50 | 9/10/19, 1 |

For A2 and A3, b/w are noise (same prompt), not effects.

- **Blank recall (declared blank):**

  | stratum | A | A3 | B | C | D |
  |---|---:|---:|---:|---:|---:|
  | W | .02 | .04 | .71 | .77 | .77 |
  | T | .11 | .11 | .16 | .32 | **.38** |

- **Loop rate** (runs, Wilson 95%):

  | arm | rate | interval |
  |---|---:|---|
  | A | 3.8% | [2.5, 5.7] |
  | A3 | 3.8% | [2.5, 5.7] |
  | B | 2.2% | [1.3, 3.8] |
  | C | 3.6% | [2.4, 5.4] |
  | D | **1.4%** | [0.7, 2.7] |

### The five clauses for v19.1 (baseline A3)
| clause | result |
|---|---|
| 1. W ∪ T fabricated falls, sign p < 0.05 | **PASS**: mean(A3−D) 0.449; 37 better / 0 worse / 32 tie; p 1.5e-11 |
| 2. T: better on more pages than worse | **PASS**: 13 > 0 |
| 3. S3 false blank ≤ A3 + 0.05 | **PASS**: 0.360 ≤ 0.368. Against A the limit is 0.372, also PASS. |
| 4. S5 median CER diff ≤ max(floor, 0.01) | **PASS**: median D − A3 = 0 |
| 5. Loop: D's Wilson lower bound ≤ A3's upper bound | **PASS**: 0.007 ≤ 0.057 |
| Not worse than v18 on W ∪ T (Amendment 1.4) | **PASS**: D better on 15, worse on 4, p 0.019 |

### D vs v18 and D vs v19 (not gating except the W ∪ T row vs v18)
| | D vs B (v18): D better / worse / tie, p | D vs C (v19) |
|---|---|---|
| W ∪ T fabricated | **15 / 4 / 50, p 0.019** | 11 / 5 / 53, p 0.21 |
| W | 5 / 2 / 24, p 0.45 | 3 / 2 / 26, p 1 |
| T | **10 / 2 / 26, p 0.039** | 8 / 3 / 27, p 0.23 |
| S3 false blank | **0 / 8 / 80, p 0.008** | 8 / 5 / 75, p 0.58 |
| S5 windowed CER | 10 / 7 / 21, p 0.63 | 15 / 6 / 17, p 0.078 |

- **Against v18,** v19.1 invents fewer pages, and the difference is significant on show-through leaves. It calls more real pages blank, also significantly.
- **Against v19,** v19.1 is ahead on every stratum, but no difference is significant.

### Stamp capture: the 20 "real mark on a show-through leaf" S3 pages
Amendment 1 fixes the per-page word list, written from the label notes before any D call (`dataset/ocr-v19-1-stamp-words.json`). One page has no legible word in its note, so the share is over 19 pages × 3 runs = 57 runs.

| | A | A2 | A3 | B | C | D |
|---|---:|---:|---:|---:|---:|---:|
| runs with a stamp word in the body (pre-registered `bodyText`) | .33 | .35 | .33 | .40 | **.47** | .32 |
| same, `body_loose` (post hoc; see below) | .39 | .39 | .39 | .42 | **.47** | .42 |
| false blank on these 20 pages | .200 | .217 | .200 | .283 | .400 | .317 |

- **v19.1 does not get more stamp words into the body than v19.** Both bodies give the same picture.
- **v19.1 does call fewer of these leaves blank** (.32 vs .40), but the two measures disagree, and reading the outputs explains why. On 6 S3 pages, C over-declined against A and D does not:
  - **2 are genuine fixes.** On the Kunst und Litteratur stamps, D puts "BIBLIOTHECA REGIA MONACENSIS Bayer. Staats-Bibliothek München" in the body. On the Berengario catalogue entry, D moves the entry out of `<insert>`.
  - **3 are D reading the mirror again.** On the Commentaria p.176 title, D transcribes it as "faint, light grey ink". On the Kashmir Series p.6 it does the same. On *Artis Cabalisticae* p.6, one run transcribes the reversed title.
  - **1 is margin numbers** on *Roma Sethianorum*.
- **v19.1 still drops the mark on most leaves.** Typically it is pushed into `<insert>` (BIBLIOTHECA REGIA MONACENSIS on *Artis Cabalisticae*; the University of Toronto library pocket on *Der böse Blick* p.507) or into `<image-desc>` (the WELLCOME stamp), and the pre-registered body excludes both.

**Scorer artefact found (post hoc, affects every arm alike).** `blank-page-study.mjs bodyText` strips `<[^>]+>`, which also reads the centring markers `->LINE<-` as a tag. Any text between two centred lines is therefore deleted from the body, so `<- BS 100 1912 Cop. 2 ->` scores 0 letters.
- **Gating outcomes:** they use the pre-registered scorer unchanged. The artefact lowers body letters on centred title pages in every arm.
- **Stamp capture:** the `body_loose` row strips only real tags and the markers, and is reported alongside.
- **Fix:** none here. The artefact belongs in a separate change to `bodyText`, with its own check of the earlier runs.

## Three examples
1. **The fix working: *Magazin der Kunst und Litteratur* 1794, a leaf with two right-reading Munich stamps and a mirror-reversed title.** https://sourcelibrary.org/book/69b51e75ff09e4fe943af1d9?page=6
   - **v16/v18** transcribe the mirrored title as this page.
   - **v19** (2/3 runs) puts the stamps only in `<meta>` / `<image-desc>`.
   - **v19.1** (3/3) puts them in the text: *"BIBLIOTHECA REGIA MONACENSIS Bayer. Staats- Bibliothek München"*.
2. **The show-through gain over v18: Philoponus, *In Meteorologicorum librum primum*, a leaf carrying only the facing title page, mirror-reversed.** https://sourcelibrary.org/book/69b1deb4ca46fa60ea1ee0fc?page=14
   - **v18** (3/3) and **v19** (3/3) read it into a title page: *"IOANNIS PHILOPONI IN METEOROLOGICORUM LIBRUM PRIMUM COMMENTARIUM"*.
   - **v19.1** (3/3): `<page-type>blank</page-type> <warning>The page appears blank; the text visible in the image is mirror-reversed show-through …</warning>`.
3. **The cost: *Der böse Blick und Verwandtes* I p.507, a library pocket.** https://sourcelibrary.org/book/69906b04e0c258ddff203b34?page=507
   - **v16, v18 and v19** transcribe it in the body: *"PLEASE DO NOT REMOVE CARDS OR SLIPS FROM THIS POCKET — UNIVERSITY OF TORONTO LIBRARY … BF 1775 S4 Bd.1 Seligmann, Siegfried"*.
   - **v19.1** (3/3) puts all of it in `<insert>` and scores 0 body letters.
   - The words are kept, but in a tag. A reader of the body sees nothing.

## Spend
- **$1.24 actual** (D $0.58, A3 $0.66), against an estimate of $1.42 and a cap of $3.
- Metered in `usage_logs` under `eval/ocr-v19-1-4195`. The ledger line is in `/root/claude-jobs/ocr-v19-1-spend.txt`.
- The reused v19 arms cost $2.72 on 2026-10-02 and were not re-run.

## What this does not settle
- **This is one k = 3 run on 195 pages.** D's lead over v19 is not significant anywhere.
- **The drift trigger fired by one page.** The verdict does not depend on the baseline.
- **S3 false blank rewards re-reading the mirror.** The metric scores a v16-style mirror transcription as "not blank". Some of D's S3 recovery over C is exactly that, so D's S3 figure flatters it.
- **The `<insert>` and `<image-desc>` habit for marks is the open problem.** Neither v19 nor v19.1 reliably puts a stamp's words in the body. A further revision would have to name `<insert>` explicitly. That would need its own pre-registered run.
- **The labels are by Claude subagents, not by a human.**
