# Results: OCR prompt v18 (blank narrowing + `<insert>`) vs v16 (#4195, #4149)

PRIOR ART: scripts/eval/PREREGISTRATION-ocr-v18-blank-insert.md is the spec this reports against. Unlike the pre-registration, this file holds the results. Earlier results files for prompt A/Bs (results/prompt-ab-*, results/blank-page-study-*) cover other arms and pages.

Run on 2026-10-02 by job `ocr-v18-ab`. Runner: `scripts/eval/ocr-v18-ab.mjs`. Numbers: `results/ocr-v18-ab-2026-10.json`. Raw reads, drawn pages and Batch job ids: `results/ocr-v18-ab-2026-10/`.

**Verdict under the pre-registered rule: NOT ESTABLISHED.** Clauses 1 (primary) and 5 fail. Recommendation: do not promote on this evidence. The default stays v16. Nothing was written to `prompts` or `pages`.

## Setup as run
- **Model and settings.** `gemini-3.1-flash-lite` via the Batch API, one job per arm. Production cross-book request: prompt, `{language_instruction}` substitution, document-context suffix, `BLOCK_NONE` safety, temperature 0.1, 16,384 max tokens, thinking budget 0, image `getPageSource(page)` resized to 1500 px.
- **Arms.** A = v16 DB row `6a98b8a0…`, content_hash `0203c264…` (verified by md5 at build time). A2 = the same prompt as an independent job. B = `prompts/ocr/standard-ocr-v18-candidate.md` (md5 recorded in the JSON).
- **Size.** k = 3 runs per (page, arm). 188 pages, 0 image fetch failures, 1,692 requests. Run outcomes:
  - text: A 543, A2 543, B 544
  - truncated: 12 / 11 / 8
  - refusal (all RECITATION): 9 / 10 / 12. Refusals are excluded from page means (amendment 6).
- **Exclusions.** 6 books were dropped at draw time as Tibetan or Syriac (S1 2, S2 1, S3 3). S2 has 37 pages, not 38. The #4149 corpus parsed with 0 rows skipped.
- **Cost.** Estimate $1.99, actual **$1.63** (metered in `usage_logs`, endpoint `eval/ocr-v18-ab-4195`).

## Per stratum
Page means over k. "spread" is the mean within-page SD across the 3 runs. "floor" is the p90 of |A − A2| over pages, the pre-registered noise floor. A/B is a paired page count with an exact sign test over non-tied pages.

| stratum | outcome | n | v16 (A) | v16 again (A2) | v18 (B) | spread A / A2 / B | floor | A ≡ A2 pages | B better / worse / tie | sign p |
|---|---|---:|---:|---:|---:|---|---:|---:|---|---:|
| S1 fabricated blank | fabricated ↓ | 40 | 0.350 | 0.375 | 0.267 | .029 / .029 / .029 | 0 | 38/40 | 5 / 2 / 33 | 0.45 |
| S2 show-through blank | blank recall ↑ | 37 | 0.712 | 0.685 | 0.649 | .016 / .016 / 0 | 0 | 35/37 | 3 / 6 / 28 | 0.51 |
| S3 sparse ink (guard) | false blank ↓ | 43 | 0.295 | 0.318 | 0.233 | .013 / .013 / 0 | 0 | 41/43 | 4 / 1 / 38 | 0.38 |
| S4 labels (diagnostic) | label capture ↑ | 28 (18 paired) | 0.367 | 0.293 | 0.521 | .001 / .001 / .006 | 0 | 16/17 | 5 / 0 / 13 | 0.06 |
| S5 clean controls (guard) | windowed CER ↓ | 38 (2 abstained) | 0.110 | 0.120 | 0.130 | .015 / .032 / .027 | 0.0095 | 21/38 | 10 / 19 / 9 | 0.14 |

Secondary rows, reported but not gating:
- S1 blank recall: A 0.258, A2 0.250, B 0.400 (B higher on 6 pages, lower on 0).
- S2 fabricated: A 0.072, A2 0.099, B 0.063.
- S3 `declared blank` alone: A 0.116, B 0.047 (B lower on 3, higher on 0).
- S4 characters inside `<insert|margin|gloss>`: A 116, A2 113, B 141.
- S4 arm means cover the pages where the ratio is defined: 19, 17 and 20 pages.

**Loop.** `loopCoverage(bodyText) > 0.5`, runs pooled over all strata, Wilson 95%:
- A 13/555 = 2.3% [1.4, 4.0]
- A2 12/554 = 2.2% [1.2, 3.8]
- B 10/552 = 1.8% [1.0, 3.3]

## Decision (pre-registered clauses)
| # | clause | test | result |
|---|---|---|---|
| 1 | S1 fabricated rate falls (primary) | mean(A−B) = 0.083 > floor 0, **and** sign p = 0.45 < 0.05 | **FAIL** |
| 2 | S3 false-blank guard | B − A = −0.062 ≤ max(0, 0.05) | PASS |
| 3 | S5 CER guard | median(B − A) = +0.0002 ≤ floor 0.0095 | PASS |
| 4 | loop guard | B lower bound 0.0099 ≤ A upper bound 0.0397 | PASS |
| 5 | S2 blank recall holds | B 0.649 ≥ A 0.712 − 0 | **FAIL** |

## What the numbers say, read against the images (post hoc; this does not change the verdict)
- **The primary test had far less to work with than planned.** On today's Flash-Lite, v16 invents text on only about 15 of the 40 #4149 pages (A 0.35, A2 0.375). Those pages were collected mostly from `gemini-3-flash-preview` output. Of the 16 pages where v16 invented at least once, v18 fixes 5 on every run. All 5 are clean white leaves where v16 writes a whole page, a recipe or an essay. v18 still invents on 11. Those are mostly leaves carrying show-through from the facing leaf, which both prompts "read" as a title page or as text (Philo Vol. 1 p.5, *Hermeneia* p.5). One is a pure-white leaf: Clement, *Stromata* p.584, where both prompts write Greek prose under a running header. On 2 pages v18 invents slightly more than v16 (≤ 30 letters).
- **The clause-5 failure is mostly a labelling problem in S2.** Six pages lost `blank` under v18. By eye, 5 of them carry real ink on the leaf:
  - a shelfmark (p.5, `69c79fed…`)
  - pencil notes (p.3, `69c7703d…`)
  - a handwritten accession number "22464 23/3/92" (p.8, `69af2335…`)
  - a manuscript note "Le parfait M. anglois" (p.20, `69c27386…`)
  - a spine title on a cover image (p.1, `69c84343…`)

  v18 types these pages `text` and transcribes or describes the mark, which is what its definition of `blank` ("no ink on this side") asks for. The S2 label comes from an earlier OCR's own `<page-type>blank</page-type>` claim, not from an eye check. The sixth page (`69c79da6…` p.−187, show-through beside an empty leaf) is a real miss, but it carries 0 body letters.
- **No sign that v18 declares real pages blank,** which was the risk that shelved v17. S3 false blank fell from 0.295 to 0.233 (4 pages better, 1 worse). S3 declared-blank fell from 11.6% to 4.7%.
- **S5:** within the floor at the median. The mean is worse by 0.02, mostly from one Kircher index page. There v18 letter-spaces "I N D E X C A P I T U M", the word-level guard then fails, and the pre-registered rule scores the page 1.0. The rest of the transcription matches v16's.
- **The noise floor is 0 on every binary stratum.** A and A2 give identical page means on 35–41 pages per stratum, so the floor rule reduces to "any difference". A/A mean gaps were 0.023–0.027 on S1–S3, against A/B gaps of 0.062–0.083.

## What a confirmatory run would need
This is a design note, not an amendment.
1. Re-label S2 by eye, so that "blank" means no ink on the leaf.
2. Build an S1 with enough pages on which the current model actually invents: a separate screening run of v16, then fresh A/A2/B runs on those pages, so the A arm is not selected on its own outcome. Split it into white leaves and show-through leaves.
3. Show-through needs its own instruction. v18's "show-through is not ink" sentence does not stop the model reading a mirror-reversed title page.
