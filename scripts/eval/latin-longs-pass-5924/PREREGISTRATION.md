PRIOR ART: `scripts/eval/experiments/2026-10-18-latin-gex45-bakeoff-5924.md` (found the gap: lite writes ſ as f, 2,566 / 3,983 ref ſ in the 1600s; recommends "lite plus a long-s pass", none built). `scripts/eval/experiments/2026-10-06-latin-print-r4-by-book-5924.md` (round 4's `lite+longs` took ſ from a **Calamari image read**, 61 CPU-s/page, and needs Kraken segmentation; this pass reads only lite's text, no image, so it is not that). `scripts/eval/latin-bakeoff-5924/score.mjs` (the scorer, used unchanged). No text-only long-s restorer found: `git grep -i "long-s pass\|post-pass\|longs"` over `scripts/` and `src/`.

# Preregistration — a text-only long-s pass for flash-lite Latin (#5924, job longs-pass-5924)

Written 2026-10-22, committed **before the pass exists and before any L+pass output is scored.** At this commit the
only things looked at on the 99 reference pages are the counts already published in the 2026-10-18 write-up.

## Question
flash-lite's Latin gap is writing ſ as f. Can a CPU pass over lite's **text** (no image, no model call) put the ſ back
well enough that lite + pass reads Latin print about as well as Gemini 3.8 Flash, century by century?

## Pages, references, scorer
- The 99 pages of `scripts/eval/benchmark/latin-refs-5924.json` (1600s 59, 1500s 40), references `benchmark/refs/<slug>.txt`.
- Scorer: `scripts/eval/latin-bakeoff-5924/score.mjs`, **unchanged**: view N (preregistered, Amendment 4), view D
  (diplomatic), and the post hoc `--fold-f` view, per century; paired bootstrap, 10,000 resamples, seed 5924.

## Arms
| arm | what |
|---|---|
| `L` | the stored lite reads, `latin-bakeoff-5924/reads/L.jsonl.gz` (gemini-3.1-flash-lite, T 0). **No new model calls.** |
| `LP` | `L` after the long-s pass. Only change allowed: an `f` becomes `ſ`. Nothing else in the text moves. |
| `F` | stored Gemini 3.8 Flash reads (`F.jsonl.gz`), the comparison target. |
| `L1a`, `L1b` | stored, the noise floor (as in Amendment 4). |

## The pass (fixed before scoring)
1. **Candidates.** Every word token holding a lower-case `f` that is not word-final. Long s never ends a word, and
   is not set before `b` or `k`: an `f` there is never changed. A word broken by a line-end hyphen is looked up whole.
2. **Variants.** Each eligible `f` independently `f` or `ſ` (cap 2^8 variants; past that, left to right).
3. **Lexicon and frequency model** built from **our own Latin**, never from the 99 reference books or any book of
   their works (`work_id`): Latin books' pages whose stored OCR came from an engine that keeps ſ / s apart. The
   corpus has no Gemini 3.8 Flash pages and no typed Latin editions in `pages` (measured 2026-10-22: no `ocr.pipeline` or
   `ocr.source` for either), so the source is **gemini-3-flash-preview** pages, each kept only if it holds none of the
   telltale ſ-as-f forms (`eft`, `funt`, `effe`, `fed`, `ipfe`, …: a page written with lite's habit is dropped).
   Tokens folded as view N folds them (lower case, ſ→s, v→u, j→i, marks dropped). Word unigrams + word bigrams.
4. **Choice.** Score each variant by an interpolated bigram model with its left neighbour and right neighbour; an
   unseen form falls back to a character 5-gram model trained on the same lexicon, and must beat the unchanged token by
   a fixed margin. Pairs where both readings are frequent Latin (fit/sit, fui/sui, fumus/sumus, fine/sine, fero/sero, forte/sorte …)
   go by the bigram context. The count of such ambiguous decisions is reported.
5. **Tuning only on a dev set that never touches the 99:** held-out flash-preview books (split by book), with lite's
   habit simulated (each non-final ſ / s written as f at the rate the bake-off measured, 2,566 / 3,983 ≈ 0.64). Every
   constant is frozen before the 99 are scored, and the frozen values go in the run record.

## Bar (all per century, view N, preregistered)
LP passes a century when **all** hold:
1. **Better than lite:** the paired bootstrap CI of median(LP − L) lies wholly below 0.
2. **Near Flash:** median N(LP) − median N(F) ≤ 0.3 points.
3. **No over-correction:** on the pages whose reference holds **no ſ**, LP raises view-N CER on no more pages than it
   lowers it, and the count of reference `f` read as `ſ` (`f_as_long_s`, score.mjs) is reported, LP vs L.

Reported, not deciding: view D, the post hoc `--fold-f` view (where LP should equal L, a check that the pass changes
nothing but f/ſ), ſ→f / ſ→s / ſ kept counts, the ambiguous-decision count, the CPU time per page.

## By eye
6 pages: the 3 largest LP gains and the 3 largest LP losses vs L (view N), read against the leaf image by an Opus
subagent, labelled `read-from-image`.

## If it passes
Count the Latin print pages whose stored OCR is lite (query written to a file), and price the unread Latin backlog as
lite Batch + pass. **No writes to `pages` in this job**; applying the pass is a separate PR and decision.

## What this cannot show
References are Opus reads (agreement with Opus, not ground truth). Only 4 of the 99 pages are gothic. Lite here ran the
bake-off's generic prompt, not production's.
