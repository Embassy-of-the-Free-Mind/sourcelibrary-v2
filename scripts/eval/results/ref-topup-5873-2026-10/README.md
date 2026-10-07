# ref-topup-5873-2026-10 — reference top-up for the Flash translation routing (#5873)

Write-up and registration: `scripts/eval/experiments/2026-10-06-reference-topup-flash-translation-5873.md`. Rule: `scripts/eval/ref-topup-5873/rule.json`.

| file | what it holds |
|---|---|
| `verdicts.md`, `summary.json` | Per language: n, served fidelity, Flash − Lite, the top-up alone, the card's line and the verdict; pools, heterogeneity, sensitivity. Written by `ref-topup-5873/analyze.mjs` from the first runs' `pages.jsonl` and this run's `results.json`. |
| `results.json` | Raw output of `translation-vs-reference/score.mjs` for the 64 added pages (gate, arms, pairs, per page). Quotes of private references are clipped to 15 words. |
| `pages.jsonl` | One row per page × arm (254 rows): fidelity by judge, the arm's text, model, tokens, Batch cost, licences. |
| `references.jsonl` | Per page: reference metadata, alignment notes, our OCR, and the reference text **only where its licence is open**. 13 in-copyright references are withheld (#5488). |
| `alignment.json` | Every drawn book in draw order: used, aligned but not used, or not aligned with the reason and the candidate pages passed over. |
| `sealed.json`, `sealed-hidden.json` | The seeded draw (seed 5873): book order and candidate pages. |
| `refusals.json` | Requests a model refused (RECITATION), and the page left without a Lite/Flash pair. |
| `context-leak-check.json` | Share of Latin-script words on each page and its neighbours (facing-translation check; meaningless for romanised Pali). |
| `gallery.md` | 5 best, 5 median and 5 worst served pages with source, reference and our English. |
| `packet/` | Judge packet key and manifest (no reference text). The packet itself is not in the repo. |
| `batch-jobs.json`, `census.json`, `briefs/` | Batch job names; live books and untranslated pages per language; the alignment brief. |

Our OCR and translations are CC BY-SA 4.0. Reference licences are per row.
Regenerate the derived files: `node scripts/eval/ref-topup-5873/analyze.mjs` (needs only the repo).
