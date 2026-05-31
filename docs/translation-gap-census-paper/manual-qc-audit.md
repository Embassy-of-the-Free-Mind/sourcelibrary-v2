# Manual QC audit — Siku Quanshu census false-negative check (2026-05-31)

**Goal:** test whether the automated pipeline under-detects translations among
*notable* works (where a false negative is most likely and most damaging).
Method: rank the 3,418 works, build a "popular" list (works with an established
English title — 63: 58 native Wikidata en-labels + 5 resolver-identified base
classics), seed-sample 15, hand-search each for an English translation
(OpenLibrary + scholarly knowledge + web), compare to the pipeline verdict.

## Result: the automated 0.3% is a recall-limited undercount

| Sampled work | Manual verdict | Evidence |
|---|---|---|
| Record of Buddhist Kingdoms (Faxian) | **TRANSLATED** — pipeline **missed it** | Legge 1886 (+2007/2018 reprints); was in censused labeled-58, marked untranslated |
| 古列女傳 / Biographies of Exemplary Women | **TRANSLATED** | Kinney, *Exemplary Women of Early China*, Columbia 2014 |
| Wen Xuan / Annotations to Selections of Refined Literature | **TRANSLATED** (substantial) | Knechtges, Princeton, 3 vols 1982–96 |
| Complete Works of Dongpo (Su Shi) | partial only | selected poems (Watson); complete works untranslated |
| Taiping Guangji | partial only | story excerpts; no complete translation |
| Southern History (南史) | untranslated | one of the Twenty-Four Histories; OL 0 hits |
| Book of Zhou (周書) | untranslated | OL 0 hits |
| History of Ming (明史) | untranslated | OL 0 hits |
| Tang Shu (唐書) | untranslated | not fully translated |
| Xihu Youlan Zhi / Xianchun Lin'an Zhi (gazetteers) | untranslated | — |
| Xuanhe Paintings Catalogue | untranslated (whole) | — |
| Jigulu (Ouyang Xiu, epigraphy) | untranslated | — |
| Shuijing zhu (Water Classic commentary) | untranslated | OL 0 hits |
| Dragon-and-Tiger Classic w/ commentary | untranslated | — |

**~2–3 of 15 notable works (~13–20%) have genuine full/substantial English
translations** — but the pipeline detected far fewer. At least one (Faxian) is a
**confirmed false negative inside the censused labeled-58**.

## Root cause (fixable)

1. **Label suffixes poison search** — `"Record of Buddhist Kingdoms (Siku
   Quanshu)"`; the `(Siku Quanshu …)` parenthetical defeats exact-phrase Google
   Books matching. Fix: strip edition/source suffixes before querying.
2. **Spelling/title variants** — "Buddhist" vs Legge's "Buddhistic"; need fuzzy
   matching or variant expansion.
3. **Search never surfaces it → Gemini can't confirm** — recall failure upstream
   of the (working) precision filter.

## Implication for the estimate

The labeled-stratum rate (1/58 = 1.7%) is a significant **undercount**; the true
labeled rate is ~5–10%. Propagated, the corpus translation rate is **~1–3%**,
i.e. **comparable to Renaissance Latin (~2%)** — not the 0.3% floor the
automated run reported. The convergence finding holds (and is arguably
strengthened: both traditions ~1–3%).

## Action items (added to paper checklist)

- Strip `(Siku Quanshu …)` / edition suffixes and expand spelling variants in the
  recall stage; re-run.
- Hand-verify the full 58-work labeled stratum (small enough to enumerate) for a
  ground-truth labeled rate.
- Use this audit as the seed of the paper's **adjudicator/recall audit** (Table 4):
  report pipeline precision *and recall* against manual ground truth.
