# BPH language-pair enrichment — eval set

## Where we are

Step 1 of 5 done: 95-row stratified hand-labeling sample is at
`~/Downloads/bph-language-eval-unlabeled.csv`. (Asked for 100; the
multilingual/compilation bucket pulled 0 rows under the patterns I tried,
so the final set is 95. Fine — not worth re-pulling.)

Source: `scripts/qa/sample-bph-language-eval.mjs` on branch `feat/bph-language-pair`.

## Bucket coverage

| Bucket | Rows | Why it's in the eval |
|---|---|---|
| ancient-greek-author | 10 | Plato/Aristotle/Galen/etc. — exercises "author signals original language = Greek" |
| ancient-latin-author | 10 | Cicero/Augustine/etc. — "author signals original = Latin" |
| medieval-arabic-author | 10 | Avicenna/Geber/etc. — "author signals original = Arabic" |
| vernacular-german-author | 15 | Paracelsus/Böhme/Khunrath — exercises both "vernacular = original" AND "Latin edition of vernacular work" cases |
| vernacular-english-author | 10 | Fludd/Dee/Vaughan — same dual case in English |
| editor-populated | 20 | Editor field present → strong translator signal. Mix of source/target pairs |
| less-famous-named-author | 15 | The medium-confidence bucket — author isn't a famous name, model has to lean on title/keywords |
| anonymous-or-missing-author | 5 | No author signal at all — pure title-language inference |

## What Derek does next

1. Open the CSV in Numbers/Excel/whatever.
2. Fill in three columns per row:
   - `LABEL_original_language` — language the work was first composed in (e.g. Latin, Greek, Arabic, German, Italian, English, French, Hebrew, …)
   - `LABEL_translation_target_language` — leave blank if this edition is in the original tongue, otherwise the language of this edition
   - `LABEL_confidence` — `high` / `medium` / `low` reflecting **your** certainty (not what a model would say). Lets us cut the eval into a strict subset later.
3. Optional: `LABEL_notes` for tricky cases — e.g. "compilation, multiple originals" or "Latin Lull + German Geber bound together".
4. Save back to `~/Downloads/bph-language-eval-labeled.csv`.

Rough time: 30–60 min if you don't get sucked into rabbit holes. About a third are obvious one-liners (Aristotle in Latin → original Greek). The hard ones are the editor-populated and less-famous-author buckets.

## Step 2-5 (after labeling)

2. **Prompt design + eval harness** (script lives in `scripts/qa/eval-bph-language-prompt.mjs`, doesn't exist yet). Feeds each row's input fields to Gemini Flash Lite, scores against the labels. Iterates the prompt until ≥90% on `original_language` and ≥85% on `translation_target_language` for the high-confidence subset.
3. **Schema migration**: add `original_language TEXT`, `translation_target_language TEXT` to `bph_works`. Index on `original_language`.
4. **Batch enrichment** via Gemini Batch API (50% cheaper, async). ~24k rows × small prompt — cents in cost. Only writes rows the model returns as `confidence: "high"`. Medium/low go to a review queue CSV for Paul.
5. **UI**: catalog detail page Language section, advanced search filter "Original language" on `BphCatalogBrowser`.

If step 2 fails to hit the eval bar, we ship the schema + UI as empty fields and tell Paul his team's manual entries can populate them — the `field_provenance` slot is already wired.

## Files
- `scripts/qa/sample-bph-language-eval.mjs` — sampler, committed on `feat/bph-language-pair` branch
- `~/Downloads/bph-language-eval-unlabeled.csv` — 95 rows, NOT committed (eval data lives outside the repo)
- This handoff — committed
