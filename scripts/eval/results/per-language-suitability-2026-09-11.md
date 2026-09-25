# Per-language OCR lane suitability (2026-09-11) — agreement with the incumbent, calibrated by its own repeat agreement

Rule: lite allowed iff median char agreement with flash ≥ 0.956 (letters+marks; calibrated ≙ 1pp CER on the pinned set), catastrophic ≤ 10%, zero invention, coverage ≥ 80%. Spend: Gemini $4.35, judge $0.07 (94 calls), Vision 206 units.

| language | n | flash unreadable | LITE agr | cata (loop/empty) | inv | cov | **lite verdict** | VISION agr | cata | cov | vision verdict |
|---|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|---|
| Arabic | 15 | 1 | 0.929 | 0 (0/0) | 0 | 15 | **flash only** — median agreement 0.929 < 0.956 | 0.849 | 5 | 14 | flash only |
| Armenian | 17 | 2 | 0.963 | 0 (0/0) | 0 | 17 | **allowed** — passes all four rules | 0.942 | 0 | 17 | flash only |
| Chinese | 19 | 1 | 0.932 | 4 (0/0) | 0 | 19 | **flash only** — median agreement 0.932 < 0.956; catastrophic 4/19 > 10% | 0.788 | 4 | 17 | flash only |
| Dutch | 17 | 3 | 0.921 | 0 (0/0) | 0 | 17 | **flash only** — median agreement 0.921 < 0.956 | 0.842 | 2 | 17 | flash only |
| English | 17 | 2 | 0.996 | 1 (0/0) | 0 | 16 | **allowed** — passes all four rules | 0.971 | 1 | 16 | flash only |
| French | 20 | 0 | 0.951 | 0 (0/0) | 0 | 20 | **flash only** — median agreement 0.951 < 0.956 | 0.906 | 2 | 20 | flash only |
| Ge'ez | 19 | 0 | 0.469 | 9 (3/0) | 0 | 19 | **flash only** — median agreement 0.469 < 0.956; catastrophic 9/19 > 10% | 0.454 | 5 | 14 | flash only |
| German | 19 | 1 | 0.972 | 1 (0/0) | 1 | 19 | **flash only** — invention on 1 page(s) — veto | 0.904 | 0 | 1 | undecided |
| Greek | 19 | 0 | 0.918 | 0 (0/0) | 0 | 19 | **flash only** — median agreement 0.918 < 0.956 | — | 0 | 0 | undecided |
| Hebrew | 2 | 0 | 0.768 | 0 (0/0) | 0 | 2 | **undecided** — only 2 scorable pages | — | 0 | 0 | undecided |
| Hindi | 0 | 0 | — | 0 (0/0) | 0 | 0 | **undecided** — only 0 scorable pages | — | 0 | 0 | undecided |
| Italian | 0 | 0 | — | 0 (0/0) | 0 | 0 | **undecided** — only 0 scorable pages | — | 0 | 0 | undecided |
| Japanese | 0 | 0 | — | 0 (0/0) | 0 | 0 | **undecided** — only 0 scorable pages | — | 0 | 0 | undecided |
| Javanese | 0 | 0 | — | 0 (0/0) | 0 | 0 | **undecided** — only 0 scorable pages | — | 0 | 0 | undecided |
| Korean | 0 | 0 | — | 0 (0/0) | 0 | 0 | **undecided** — only 0 scorable pages | — | 0 | 0 | undecided |
| Latin | 0 | 0 | — | 0 (0/0) | 0 | 0 | **undecided** — only 0 scorable pages | — | 0 | 0 | undecided |
| Malay | 0 | 0 | — | 0 (0/0) | 0 | 0 | **undecided** — only 0 scorable pages | — | 0 | 0 | undecided |
| Middle English | 0 | 0 | — | 0 (0/0) | 0 | 0 | **undecided** — only 0 scorable pages | — | 0 | 0 | undecided |
| Ottoman Turkish | 0 | 0 | — | 0 (0/0) | 0 | 0 | **undecided** — only 0 scorable pages | — | 0 | 0 | undecided |
| Pali | 0 | 0 | — | 0 (0/0) | 0 | 0 | **undecided** — only 0 scorable pages | — | 0 | 0 | undecided |
| Persian | 4 | 0 | 0.894 | 1 (1/0) | 0 | 4 | **undecided** — only 4 scorable pages | — | 0 | 0 | undecided |
| Portuguese | 18 | 2 | 0.994 | 1 (1/0) | 0 | 18 | **allowed** — passes all four rules | — | 0 | 0 | undecided |
| Russian | 19 | 0 | 0.996 | 0 (0/0) | 0 | 18 | **allowed** — passes all four rules | — | 0 | 0 | undecided |
| Sanskrit | 20 | 0 | 0.382 | 6 (2/0) | 0 | 19 | **flash only** — median agreement 0.382 < 0.956; catastrophic 6/20 > 10% | 0.169 | 6 | 5 | flash only |
| Spanish | 18 | 1 | 0.972 | 0 (0/0) | 0 | 18 | **allowed** — passes all four rules | 0.867 | 1 | 17 | flash only |
| Syriac | 20 | 0 | 0.245 | 8 (4/0) | 0 | 18 | **flash only** — median agreement 0.245 < 0.956; catastrophic 8/20 > 10% | 0.097 | 8 | 7 | flash only |
| Tibetan | 20 | 0 | 0.222 | 11 (5/1) | 0 | 17 | **flash only** — median agreement 0.222 < 0.956; catastrophic 11/20 > 10% | 0.273 | 9 | 18 | flash only |

Tibetan Derge identity: NOT APPLICABLE — sampled books are not Kanjur — retrieval at floor for every arm; identity is unjudgeable (non-latin-text-operations.md). Only the #4523 pilot Kanjur (vision-vs-gemini-2026-09-11) carries a Derge number.

## Differences from the current LATIN_SCRIPT_LANGUAGES allowlist (translate-core.mjs / ai-models.ts)

- **Armenian** — allowlist says flash, measured allowed (passes all four rules) → ADD to the lite allowlist
- **Dutch** — allowlist says lite, measured flash only (median agreement 0.921 < 0.956) → REMOVE from LATIN_SCRIPT_LANGUAGES (or stratify)
- **French** — allowlist says lite, measured flash only (median agreement 0.951 < 0.956) → REMOVE from LATIN_SCRIPT_LANGUAGES (or stratify)
- **German** — allowlist says lite, measured flash only (invention on 1 page(s) — veto) → REMOVE from LATIN_SCRIPT_LANGUAGES (or stratify)
- **Russian** — allowlist says flash, measured allowed (passes all four rules) → ADD to the lite allowlist
- **Italian** — allowlist says lite, measured undecided (only 0 scorable pages) → on lite today without a passing measurement
- **Latin** — allowlist says lite, measured undecided (only 0 scorable pages) → on lite today without a passing measurement
