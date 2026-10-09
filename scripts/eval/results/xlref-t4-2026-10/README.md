# xlref-t4-2026-10 — #5695 track T4 (Hebrew/Aramaic, Arabic, Persian)

Served English and lever arms scored against published human translations. Write-up:
`scripts/eval/experiments/2026-10-03-translation-vs-reference-t4-hebrew-arabic-persian-5695.md`.

| file | what it holds |
|---|---|
| `pages.jsonl` | One row per page × arm (526 rows): scores by judge, defects, reversals, the arm's full text, model, tokens, cost, and three licences (scan, our text, reference) with `publishable` flags. `packet` 1 = judged against the OCR; `packet` 2 = `judged_against_source` says whether the judges saw the corrected transcription. |
| `references.jsonl` | Per page: reference metadata, alignment notes, our OCR, and the reference text **only where its licence is open**. Five in-copyright references are withheld (#5488). |
| `summary.json` | Every table in the write-up, with CIs: strata, arms, noise floor, levers, corrected-transcription effect, cause shares, cost at corpus scale. |
| `results.json`, `results-packet2.json` | Raw output of `translation-vs-reference/score.mjs` for the two packets (gate, arms, pairs, per page). |
| `dimensions.json` | The separate six-dimension pass (ours and the reference), stance labels, meaning disagreements. |
| `image-check.json` | 33 pages whose image was opened: primary cause, image reading against the OCR, OCR error rate by eye. |
| `corrected-transcriptions/` | 30 page transcriptions corrected by eye against the image (ours, CC BY-SA 4.0). Usable as an OCR reference set for these scripts. |
| `gallery.md`, `gallery.json` | 5 best / 5 median / 5 worst served pages with open references, plus two pages for a principles discussion. |
| `books-not-aligned.json` | 17 books tried and not aligned, with the reason and every candidate page passed over. |
| `context-leak-check.json` | Share of Latin-script text on each page and its neighbours (facing-translation check). |

Licences: our OCR and translations are CC BY-SA 4.0. Reference licences are per row; CC-BY-NC rows carry `reference_non_commercial: true`.
The judge packets (which contain the private reference texts) are not in the repo.
Regenerate the derived files with `python3 scripts/eval/xlref-t4/report.py <private work dir> scripts/eval/results/xlref-t4-2026-10`.
