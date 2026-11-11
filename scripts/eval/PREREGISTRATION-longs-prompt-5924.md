# PREREGISTRATION — can flash-lite read long s on Latin print if the prompt asks? (#5924)

PRIOR ART: `PREREGISTRATION-open-engine-print-5660.md` Amendment 4 (the 99 pages, fed images, references, views and
bar this reuses); `scripts/eval/experiments/2026-10-18-latin-gex45-bakeoff-5924.md` (lite writes ſ as f 2,566 / 2,285
times in the 1600s / 1500s; that is its whole gap); `scripts/eval/experiments/2026-10-01-does-a-long-s-prompt-line-fix-early-english-ocr-5488.md`
and `scripts/eval/long-s-tcp-ab.mjs` (LONG_S_LINE on early English: misreads 138 → 85, not significant per page; used
only on the RECITATION retry, PR #5526). Never measured on Latin; no visual-example arm was ever tried.

Written and committed before any call of this run. Job `longs-prompt-5924`, 2026-10-22. Asked by Derek: "can we make
the flashlite better at long s?"

## Pages and images
- The 99 frozen Latin leaves of `scripts/eval/benchmark/latin-refs-5924.json` (59 × 1600s, 40 × 1500s), one per book.
- References: the Opus leaf references in `scripts/eval/benchmark/refs/`, unchanged.
- Images: the same fed images as PR #6912. Rebuilt from the cached leaves with the same `prep.py` rule (2,400 px cap,
  Pillow LANCZOS, JPEG q92); **all 99 sha256 match `latin-bakeoff-5924/inputs.json` `fed.sha256`** (checked before
  this file was written).

## Arms
All: `gemini-3.1-flash-lite`, paid realtime API, temperature 0, thinking budget 0 (except L4), maxOutputTokens 16,000,
through `scripts/lib/gemini-script-client.mjs` (metered). Harness `latin-bakeoff-5924/longs-prompt-arm.mjs`.
The base is production's **live** OCR prompt read from Mongo (`getProductionOcrPrompt`, v19.1 "Standard OCR" at
write time; its version and hash are recorded in each run file). The stored bake-off arm L used the generic prompt of
rounds 1–4, so it is not a pair for these arms; it is reported alongside as `Lg`, for reference only.

| arm | prompt |
|---|---|
| L0 | live prompt |
| L0b | L0 again (noise floor at temperature 0) |
| L1 | live + `LONG_S_LINE` (imported from `scripts/lib/ocr-long-s-retry.mjs`, sited at its anchor, unchanged) |
| L2 | L1 + `LONG_S_RULE`: ſ has no crossbar on the right / f's crosses the stem; never word-final; ſſ, ſt, ſp … ligatures; Latin examples |
| L3 | L2 + `EXAMPLES_LINE` + two crops sent before the page, with their transcriptions in the prompt |
| L4 | L2 with thinking budget 1,024 (run only if the cost after L0–L3 leaves room under the cap) |

L3's crops come from a book that is **not** among the 99: BNC Florence, *Inquisitio in Oracula Sibyllarum* (1664),
`https://archive.org/download/ita-bnc-mag-00002754-001/page/n29/full/full/0/default.jpg` (sha256 `132237e4…e604734`), p. 5:
- `longs-examples/roman.jpg` (3 lines of roman, sha256 `2cb0a46a…707dba4`),
- `longs-examples/italic.jpg` (5 lines of italic verse, sha256 `ab09412c…0fe9fc`).
Their transcriptions were made by eye from the crops.

## Scoring
- **Output prep (same for every arm):** the live prompt answers in tagged Markdown. Before scoring, metadata blocks
  (`<vocab>`, `<image-desc>`, `<language>`, `<page-type>`, `<scan-quality>`, `<script>`, `<columns>`, `<meta>`,
  `<warning>`) are removed with their content and other tags are unwrapped, by `stripTags` of
  `scripts/eval/lib/edition-window.mjs` (header, page number, signature and margin text are page text and stay).
  The raw output is kept in each row.
- **Scorer:** `latin-bakeoff-5924/score.mjs`, unchanged, with L0 in the baseline slot (`L.jsonl`).
- **Primary:** view N (latin-norm@1, ſ→s v→u j→i, f stays f), per century, median page CER with a paired bootstrap CI
  of the median Δ vs L0 (10,000 resamples, seed 5924).
- **Bar, per century, for each of L1–L4 vs L0 — all three:**
  1. the CI of the median paired Δ N lies wholly below 0;
  2. |median Δ| exceeds the noise floor, the median |L0 − L0b| page N (if that floor is 0, criterion 2 is Δ < 0);
  3. catastrophic pages (CER > 0.5, a loop, or empty/refused) ≤ L0's + 1.
- **Secondary:** view D (diplomatic); ſ outcomes (reference ſ read as f / s / ſ; f read as ſ — the overcorrection
  count); refusals (empty text, finish ≠ STOP); the post-hoc `--fold-f` view as a sensitivity only.
- **Best arm:** the passing arm with the lowest median N pooled over both centuries; if none passes, the arm with the
  lowest pooled median N, named as such.
- **Combination with a post-pass:** if the sibling job `longs-pass-5924` has a CPU long-s pass on disk when scoring,
  the best arm's output is also scored after that pass (and L0 after it), reported as secondary.
- **By eye:** 6 pages (the best arm's 3 largest gains and 3 largest losses vs L0, pooled), read from the image by an
  Opus subagent with no score shown.

## Cost
Hard cap $3.00 for the whole run (the harness stops at `--max-cost`). Estimate before running: about $0.0025 per
page read (≈4,000 input, ≈900 output tokens) × 99 × 5–6 arms ≈ $1.25–1.5. Measured after L0, before the rest.

## What a pass would mean
Nothing changes in production from this run. The prompt is a Mongo record; changing it for pre-1800 Latin print is a
separate PR and a decision, and re-OCR triggers retranslation. No writes to pages, books or prompts.
