# OCR prompt v19 confirmatory run: result (#4195)

PRIOR ART: scripts/eval/RESULTS-ocr-v18-blank-insert.md (the run this follows up; same request, same scorer).

Spec: `PREREGISTRATION-ocr-v19-showthrough.md` plus Amendment 1 (written after the labels and before any arm was built). Runner: `ocr-v19-ab.mjs`, which imports its stages from `ocr-v18-ab.mjs`. Numbers: `results/ocr-v19-ab-2026-10.json`. Raw reads, including the screen: `results/ocr-v19-ab-2026-10/`. Labels: `dataset/ocr-v19-labels.jsonl`.

## Recommendation, by the pre-registered rule: **v18**
- **v19 (C) fails one clause.** It is the S3 over-decline guard: C's false-blank rate is 0.381, against a limit of A 0.322 + 0.05 = 0.372.
- **v18 (B) passes all five clauses.** The rule says that when v19 fails and v18 passes, the recommendation is v18.
- The promote is Derek's call. This run wrote no `prompts` row and nothing to `pages`.

**The plain answer.** Do v18 and v19 stop the model inventing a page on a blank leaf without calling real pages blank? Mostly, yes.
- **Clean white leaves.** v16 invents a whole page on 91% of runs. v18 cuts that to 29% and v19 to 22%.
- **Show-through leaves.** v16 "reads" the mirror-reversed page on 68% of runs. v18 cuts that to 55% and v19 to 46%.
- **Real pages.** v18 calls real pages blank slightly less often than v16 does. v19 does it more often. The excess is concentrated where a page carries both show-through and a small right-reading mark (see "Where v19's over-decline comes from").

## Design, as run
- **Model and request.** `gemini-3.1-flash-lite` via Batch, using the production cross-book request (prompt + document context, `OCR_GENERATION_CONFIG`, 1500 px).
- **Arms, k = 3 each.** A = v16 (DB row, hash `0203c264…` verified). A2 = v16 again, an independent job. B = v18 (hash `e6e57ce9…`, the same file as the v18 run). C = v19 (hash `bef330b9…`).
- **Screen.** The pool was 414 pages after Tibetan and Syriac were excluded. One v16 read per page ($0.29) left 127 qualifying pages (> 20 body letters). The screen reads are not used in any outcome.
- **Labels.** 161 pages were labelled by eye before any arm ran, each from the original image plus a contrast-stretched copy: white 74, show-through 42, real ink 45. Two pages with a digital overlay were relabelled real ink (Amendment 1).
- **Strata.**
  - **W** (white): 31 pages, one per book (63 eligible pages in 31 books).
  - **T** (show-through): 38 pages.
  - **S3** (real ink): 88 pages, the 43 from v18 plus the 45 labelled real ink.
  - **S5** (#5250 references): 38 pages.
  - That is 195 pages and 2,340 requests.
- **One re-submission.** The first arm-A job came back `BATCH_STATE_CANCELLED` at the first poll, with 0 of 585 requests processed and $0 spent. I don't know why. It was re-submitted unchanged as a fresh job about 15 minutes later, and both jobs are recorded in the results JSON.

## Results
Each cell is the page mean of the per-page rate over k = 3. "Better/worse/tie" is the second arm against the first, counting only pages that move by at least the threshold. The threshold is the p90 of |A − A2|, or 1/k when that p90 is 0.

| stratum | outcome | n | v16 A | v16 again A2 | v18 B | v19 C | spread across k (A/A2/B/C) | floor | threshold | C vs A: better/worse/tie, sign p | B vs A: better/worse/tie, sign p |
|---|---|---:|---:|---:|---:|---:|---|---:|---:|---|---|
| **W ∪ T (primary)** | fabricated ↓ | 69 | 0.783 | 0.780 | 0.435 | **0.348** | n/a | 0.333 | 0.333 | **36 / 1 / 32, p 5.5e-10** | 29 / 0 / 40, p 3.7e-9 |
| W white | fabricated ↓ | 31 | 0.914 | 0.882 | 0.290 | **0.215** | .093 / .056 / 0 / .019 | 0 | 0.333 | 25 / 0 / 6, p 6.0e-8 | 22 / 0 / 9, p 4.8e-7 |
| T show-through | fabricated ↓ | 38 | 0.675 | 0.697 | 0.553 | **0.456** | .030 / .064 / .030 / .046 | 0.333 | 0.333 | 11 / 1 / 26, p 0.006 | 7 / 0 / 31, p 0.016 |
| S3 real ink | false blank ↓ | 88 | 0.322 | 0.318 | 0.299 | **0.381** | .026 / .033 / .013 / .047 | 0 | 0.333 | 6 / 13 / 69, p 0.17 | 7 / 5 / 76, p 0.77 |
| S5 references | windowed CER ↓ | 38 | 0.102 | 0.102 | 0.117 | 0.137 | .002 / .003 / .025 / .018 | 0.0025 | 0.0025 | 9 / 14 / 15, p 0.40; median C−A 0 | 7 / 12 / 19, p 0.36; median B−A +0.0003 |

- **Blank recall** (declared blank with ≤ 20 body letters):

  | | v16 A | v16 again A2 | v18 B | v19 C |
  |---|---:|---:|---:|---:|
  | W ∪ T | 0.068 | 0.072 | 0.406 | 0.522 |
  | W | 0.02 | 0.02 | 0.71 | 0.77 |
  | T | 0.11 | 0.11 | 0.16 | 0.32 |

- **A vs A2 (the noise floor).** Page counts higher / lower / tie: W 3 / 0 / 28, T 1 / 3 / 34, S3 2 / 2 / 84, S5 2 / 2 / 34.
- **Loop rate** (runs, Wilson 95%):

  | arm | rate | interval |
  |---|---:|---|
  | A | 3.8% | [2.5, 5.7] |
  | A2 | 3.6% | [2.4, 5.5] |
  | B | 2.2% | [1.3, 3.8] |
  | C | 3.6% | [2.4, 5.4] |

### Decision clauses
| clause | v19 (C) | v18 (B) |
|---|---|---|
| 1. W ∪ T fabricated falls, sign p < 0.05 | **PASS**: mean(A−C) 0.435, 36 / 1, p 5.5e-10 | **PASS**: mean(A−B) 0.348, 29 / 0, p 3.7e-9 |
| 2. T: better on more pages than worse | **PASS**: 11 > 1 | **PASS**: 7 > 0 |
| 3. S3 false blank ≤ A + 0.05 | **FAIL**: 0.381 > 0.372 | **PASS**: 0.299 ≤ 0.372 |
| 4. S5 median CER diff ≤ max(floor, 0.01) | **PASS**: 0 | **PASS**: +0.0003 |
| 5. Loop: Wilson lower bound ≤ A's upper bound | **PASS**: 0.024 ≤ 0.057 | **PASS**: 0.013 ≤ 0.057 |

### v18 vs v19 (B vs C, not gating)
- **W ∪ T:** C better on 11 pages, worse on 4, p 0.12. W alone is 5 / 2 (p 0.45); T alone is 6 / 2 (p 0.29).
  - So the show-through section moves v19 ahead of v18 on show-through leaves: blank recall 0.32 vs 0.16, fabricated 0.46 vs 0.55.
  - That lead is not significant at this n.
- **S3:** C is worse than B on 11 pages and better on 1 (p 0.006). This is the clear cost of the new text.

### v18 vs v16 on the relabelled strata (B vs A, not gating)
- v18 now passes every clause.
- The v18 run was not established because its S1 had little signal and its S2 labels were wrong.
- With screened pages and labels by eye, v18's improvement is large and clear on white leaves, 22 better / 0 worse. It is smaller but significant on show-through leaves, 7 / 0, p 0.016.

### Context echo
A run "echoes" if its header or body shares a 4+-letter token with the book's title or author. Counted over W ∪ T runs:

| arm | all runs | runs that fabricated |
|---|---:|---:|
| v16 A | 57.6% (118/205) | 71.9% (115/160) |
| v16 again A2 | 54.4% | 67.7% |
| v18 B | 28.2% | 65.2% (58/89) |
| v19 C | 23.7% (49/207) | 68.1% (49/72) |

- **The context section cuts the number of inventions, not their kind.** Echo falls in step with fabrication. But when v19 still invents, 68% of those runs still echo the book's title or author, the same share as v16.
- The Clement white leaf is the example: v16 and v18 write a Clement running header and Greek on 9/9 runs, while v19 says blank on 3/3.

### Where v19's over-decline comes from (post hoc, not gating)
S3 false blank, split by the label note:

| S3 subset | n | A | A2 | B | C |
|---|---:|---:|---:|---:|---:|
| v18's 43 sparse-ink pages | 43 | 0.310 | 0.287 | 0.209 | 0.310 |
| real ink, no show-through | 25 | 0.440 | 0.453 | 0.467 | 0.487 |
| real ink + show-through (a mark on a leaf whose main text is mirror-reversed) | 20 | 0.200 | 0.217 | 0.283 | **0.400** |

- **Most of C's excess is in the third row.** There, v16 "avoids" a false blank by transcribing the mirror-reversed page, which is itself the error this run is about.
- **v19 correctly refuses the mirrored page, then drops the small real mark,** or describes it in `<meta>` / `<image-desc>`, which scores 0 body letters.
- **Three of these, checked by eye afterwards:**
  - *Kunst und Litteratur* p.6: right-reading Munich library stamps on a mirror-reversed title.
  - The Trübner leaf p.8: mirror-reversed title and pencil notes.
  - Nebel *Disquisitio* p.2: the title reads right-to-left, "MEDICA," first. The subagent's note called it right-reading. The label stays real ink because of the ink marks top-left.
- **Of the 13 S3 pages where C over-declines against A:** 6 are real ink + show-through, 4 are v18 pages and 3 are pages without show-through.
- **Two of the over-declines are tagging, not blanking:**
  - p.227 of the Berengario catalogue: C puts the entry in `<insert>`.
  - *Roma Sethianorum* p.386: C emits only `<margin>` line numbers.
- The pre-registered measure counts all of these as false blanks, and the verdict stands on it.

### S5
- Median C − A is 0, so the guard passes.
- **The higher mean (0.137 vs 0.102) comes from three pages:**
  - a Plato *Opera* page where no C run aligns, so the rule scores it 1.0;
  - *De merocele*, 0.019 → 0.105;
  - page `6a50754778825bd7fde1709e`, 0.070 → 0.392, where B is just as bad (0.385).
- B also has a higher mean (0.117). It comes mostly from the Kircher *Turris Babel* index page, which was also v18's outlier.

## The three clearest examples
1. **Fixed by v19, not by v18:** a white leaf in Clement of Alexandria's *Stromata* VII. https://sourcelibrary.org/book/69ad716ac5001c07fa847f7d?page=584
   - Every pixel is 255.
   - **v16** (6/6 runs) and **v18** (3/3 runs) give header `ΚΛΗΜΕΝΤΟΣ ΑΛΕΞΑΝΔΡΕΩΣ ΣΤΡΩΜΑΤΕΩΝ Ζ΄` and then Greek. v16: *"οὐ γὰρ ἂν εἴη ὁ θεὸς αἴτιος κακῶν, ὡς οἴονταί τινες, οὐδὲ ἑκὼν ἀδικεῖ…"*; v18: *"οὐ γὰρ ἂν εἴη ὁ θεὸς αἴτιος κακῶν· οὐ γὰρ βούλεται…"*.
   - **v19** (3/3): `<page-type>blank</page-type> <meta>The provided image is a blank white page.</meta>`.
2. **Fixed by v19, not by v18:** a show-through leaf in Dioscurides, *De materia medica* vol. 2. https://sourcelibrary.org/book/69b1deeaca46fa60ea1ee933?page=4
   - The leaf carries only the mirror-reversed title page from the other side.
   - **v16** (6/6) and **v18** (3/3) "read" it into a title page: *"PEDANII DIOSCORIDIS DE MATERIA MEDICA LIBRI III-IV BEROLINI APUD WEIDMANNOS MCMVI"*.
   - **v19** (3/3): `<page-type>blank</page-type> <warning>The page is blank; the text visible is mirror-reversed show-through from the recto.</warning>`.
3. **The cost:** *Magazin der Kunst und Litteratur* 1794. https://sourcelibrary.org/book/69b51e75ff09e4fe943af1d9?page=6
   - The leaf has a mirror-reversed title page showing through and two right-reading library stamps.
   - **v16/v18** transcribe the mirrored title as if it were this page: *"Kunst und Litteratur. Magazin der Kunst und Litteratur. 1794."*
   - **v19** (2/3 runs) refuses it, and puts the stamps only in tags: `<meta>The page contains institutional ownership stamps from the Bayerische Staatsbibliothek.</meta> <image-desc …>Blue ink stamp: BIBLIOTHECA REGIA MONACENSIS</image-desc>`. It is scored a false blank.
   - v19 is right not to read the mirror. It is wrong to leave "BIBLIOTHECA REGIA MONACENSIS" out of the text, which a reader would want transcribed.

## Spend
**$2.72 actual**, against an estimate of $3.29 and a cap of $6.

| component | cost |
|---|---:|
| screen, 414 requests | $0.29 |
| A | $0.58 |
| A2 | $0.60 |
| B | $0.53 |
| C | $0.73 |
| cancelled A job | $0 |

Metered in `usage_logs` under `eval/ocr-v19-ab-4195`. The ledger line is in `/root/claude-jobs/ocr-v19-ab-spend.txt`.

## What this does not settle
- **This is one k = 3 run.**
- **v19's lead over v18 on show-through is not significant** (6 / 2 on T).
- **A v19.1 is not tested.** It would say: "show-through plus a stamp or shelfmark → transcribe the mark as text, the page is not blank". That might keep v19's show-through gain without the S3 cost.
- **The labels are by Claude subagents, not by a human.** One label note (Nebel) was wrong about direction, though not about the label.
