# Does the predictor learn errors or instruments? (#6420, error zoo v2)

10695 fresh, non-correction label rows; 3179 books; 20 methods.

## 1–2. Frame-only baseline and within-instrument AUC

| target | base | pooled AUC, all features | pooled AUC, frame only (store, method, selection, exposure, reader) | pooled AUC, text+catalogue without frame | mean within-method AUC (text+catalogue) |
|---|---|---|---|---|---|
| any serious finding | 43% | 0.842 | 0.699 | 0.814 | 0.785 |
| serious OCR-stage finding or wrong leaf | 31% | 0.883 | 0.656 | 0.875 | 0.853 |
| text not on the leaf (inventing kinds) | 15% | 0.900 | 0.803 | 0.828 | 0.684 |

The text+catalogue model has no store or method column, but it can still learn the frame through features that differ by frame (provider, prompt version, language mix). Within-method AUC removes the between-frame base rates, so it is the honest number.

Within the weekly audit only (the uniform frame), per target, from the pooled text+catalogue model and from a model trained on the audit alone:

| target | audit base | pooled model, scored in the audit | audit-only model | random stratum only (pooled model) |
|---|---|---|---|---|
| any serious finding | 36% | 0.705 | 0.734 | 0.756 |
| serious OCR-stage finding or wrong leaf | 16% | 0.832 | 0.816 | 0.854 |
| text not on the leaf (inventing kinds) | 13% | 0.695 | 0.685 | 0.739 |

Within-method AUC, any serious (text+catalogue model):

| method | n | base | AUC within |
|---|---|---|---|
| ocr-convergence | 2933 | 42% | 0.835 |
| paired-fifths-check | 2927 | 67% | 0.801 |
| convergent-audit-weekly | 1808 | 36% | 0.705 |
| judged-pages | 1055 | 22% | 0.755 |
| shelf-overview | 559 | 32% | 0.871 |
| fortnightly-spot-check | 215 | 24% | 0.816 |
| leak-off-leaf-5309 | 199 | 14% | 0.780 |
| leak-repair-5026 | 194 | 22% | 0.669 |
| served-audit | 171 | 36% | 0.718 |
| euro-gpu-agy-cell-6871 | 168 | 10% | 0.696 |
| lane-spot-check | 137 | 18% | 0.617 |

## 3. Can the text tell which instrument judged the page?

One-vs-rest AUC for "this page was judged by method M", from the text and catalogue features alone, out-of-book:

| method | share of rows | AUC |
|---|---|---|
| ocr-convergence | 31% | 0.918 |
| paired-fifths-check | 31% | 0.904 |
| convergent-audit-weekly | 19% | 0.860 |
| judged-pages | 11% | 0.873 |
| shelf-overview | 6% | 0.919 |
| fortnightly-spot-check | 2% | 0.793 |

Above ~0.8 means the features carry the frame: a model fed these rows can learn "which queue" as a proxy for "how bad".

## 4. Same page, same text, two instruments: the agreement ceiling

Only pages where neither label is stale (the live text has not changed since either judgment), so both judged the text that is served now.

| instruments A / B | pages | target | A rate | B rate | raw agree | kappa | ceiling: A predicts B (balanced acc.) | score AUC vs A | score AUC vs B |
|---|---|---|---|---|---|---|---|---|---|
| convergent-audit-weekly / ocr-convergence | 217 | any | 51% | 0% | 50% | 0.01 | 0.75 | 0.64 | 0.96 |
| convergent-audit-weekly / ocr-convergence | 217 | ocr | 11% | 0% | 89% | 0.07 | 0.95 | 0.68 | 0.96 |
| convergent-audit-weekly / ocr-convergence | 217 | leaf | 16% | 0% | 84% | 0.00 | nan | 0.44 | nan |
| hide-broken-text / shelf-overview | 59 | any | 85% | 85% | 100% | 1.00 | 1.00 | 0.52 | 0.52 |
| hide-broken-text / shelf-overview | 59 | ocr | 63% | 63% | 100% | 1.00 | 1.00 | 0.63 | 0.63 |
| hide-broken-text / shelf-overview | 59 | leaf | 51% | 51% | 100% | 1.00 | 1.00 | 0.60 | 0.60 |

Kappa near 0 means the two instruments agree no better than chance on that target, on the same text. A score whose AUC against one instrument exceeds what the other instrument achieves (the balanced-accuracy ceiling) is fitting that instrument, not the page.

### The headline 46%: how much was stale text and scope?

- every shared label (as first reported), target any: n=483, raw agree 46%, kappa -0.11 (A 10%, B 48%)
- every shared label (as first reported), target ocr: n=483, raw agree 81%, kappa -0.04 (A 10%, B 10%)
- both labels fresh, target any: n=410, raw agree 50%, kappa 0.00 (A 0%, B 50%)
- both labels fresh, target ocr: n=410, raw agree 90%, kappa 0.04 (A 0%, B 11%)

## 5. Test-retest: the same Opus audit reader on the same page, different rounds

143 pages read at least twice on unchanged text.

| target | pairs | raw agree | kappa |
|---|---|---|---|
| any serious finding | 331 | 97% | 0.95 |
| serious OCR-stage finding or wrong leaf | 331 | 97% | 0.85 |
| text not on the leaf (inventing kinds) | 331 | 98% | 0.93 |

Caution: the weekly audit sends the same packet text and the same frozen brief each round, so this is the reader agreeing with itself on identical input, an upper bound on reliability, not evidence of validity.

## 6. Do minor and moderate findings carry signal? (weekly audit, Opus)

n=1920 pages. Spearman ρ with the reader's 1–5 translation score: serious -0.81, moderate -0.58, minor 0.11.
With the 1–5 OCR score: serious -0.49, moderate -0.48, minor -0.15.
Minor count on the first read as a predictor of a serious finding on the repeat read: AUC 0.43 (n=143).

