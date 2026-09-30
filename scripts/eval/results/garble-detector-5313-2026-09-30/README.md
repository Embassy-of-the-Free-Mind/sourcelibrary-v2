# Cheap garble detector for OCR text — measured, not shipped (#5313, 2026-09-30)

PRIOR ART: `../translation-corpus-audit-2026-09-30/` is the reference (the Opus judge's `garble_passthrough` flag); `scripts/eval/EXPERIMENTS.md` carries the one-entry log line.

## Question

The reader note (`pageReadCaution`, PR #5315) fires only where the OCR itself admitted difficulty. The corpus audit's judge found fluent prose over garbled source on about 6.6% of served pages, and most of those carry no OCR self-report. Can a no-model, no-image score over `ocr.data` find those pages with precision ≥ 0.8, good enough to store as `ocr.read_quality` for the reader note to use?

## Answer: no

| Verdict | Flagged | TP | FP | Precision | Recall |
|---|---:|---:|---:|---:|---:|
| @1: OOV > language p98 and ≥ median + 0.20, or filler ≥ 8%, or repeat ≥ 35%, or loop ≥ 30% | 25 | 6 | 19 | 0.24 | 0.19 |
| @2: OOV > language p90 and ≥ median + 0.30, or exact loop ≥ 50% | 5 | 3 | 2 | 0.60 | 0.09 |
| `pageReadCaution` alone (#5315) | 7 | 1 | 6 | 0.14 | 0.03 |

- **Reference:** 327 judged `main` pages, one per book, from the #5274 audit and the monthly run (PR #5319). 32 are positive; 15 of them are major. `measure: judged` (agreement with a judge that read the OCR text, not the image).
- **Ranking power is weak.** AUC is 0.74 for raw OOV and 0.61 for OOV relative to the language median. No threshold sweep point reaches 0.8 precision. The best is 0.60 on 5 flags; one of the 2 false positives is letter-soup Tibetan the judge did not flag, which would make it 4/5.
- **The reference set is also the tuning set.** @2 was chosen on these pages, so 0.60 is optimistic.
- **Corpus (local mirror, 6.03M OCR pages, 5.55M judgeable):** @2 flags 0.56% of translated judgeable pages (25,851 pages in 2,301 books); only 664 of those already get the reader note. A hand read of 20 flags, one per book in seeded order and read from the OCR text (not the images), found 3 garbled (a Tibetan degeneration loop, a Mozi page with a systematic 冗-for-穴 misread, a Byzantine minuscule page), 1 ambiguous (a letter-spaced papyrus transcription with lacunae) and 16 clean. **Corpus precision is about 15–20%.** Do not quote the 25,851 as a garble count.

## Why it fails

1. **The judge's garble is mostly phrase-level.** 17 of the 32 positives are "minor": two or three misread words inside an otherwise clean page. A page-level rate cannot see them; their OOV sits inside the clean distribution for Latin, French, German and Italian.
2. **The catalogue language is not the page's language.** Many high-OOV pages are clean text in another language or script: a Greek index in a "Latin" book, Arabic in a "Latin" gospel, Egyptian transliteration in an "English" book, Hebrew in a Latin grammar. The per-language baseline cannot tell these apart from garble.
3. **Lists, tables, registers, place names and rare languages** (word lists, Aldine signature registers, itineraries, Kaqchikel, Ge'ez) miss a corpus lexicon by design.
4. **Refrains are not loops.** Filler and non-periodic repeat fired on litanies, dhāraṇī, mandala-rite enumerations and tables: 16 of @1's 19 false positives.

## What would work instead

- A **per-page language ID** before the OOV score (fixes cause 2), and page-type exclusion of `index`, `toc` and table-dominated pages (cause 3). Both are cheap, but would still leave cause 1.
- **Phrase-level garble** (cause 1) is the source-grounded judge's job, or a model-perplexity score. Neither is $0.
- The **exact loop** feature is already good and already gated at write time (`ocr-loop-guard.mjs`). Of the @2 flags, 43,543 are loop pages across all OCR, translated or not. `scripts/audit/ocr-loop-corpus.mjs` owns that count.

## Files

- `reference-pr-v1.json`, `reference-pr-v2.json`: per-verdict P/R, flagged and missed pages with URLs.
- `corpus-summary-v2.json`: whole-mirror flag rates by language (@2).
- `corpus-flag-sample.jsonl`: the 20 hand-read corpus flags.
- `baselines-oov.json`: per-language and per-script OOV quantiles from the mirror.

Reproduce (local mirror, $0):

    node scripts/audit/ocr-garble-lexicon.mjs
    node scripts/audit/ocr-garble-corpus.mjs
    node scripts/audit/ocr-garble-corpus.mjs --summarise --sample=20
    node scripts/eval/garble-detector-5313.mjs --audit=scripts/eval/results/translation-corpus-audit-2026-09-30 --audit=<monthly run dir>
