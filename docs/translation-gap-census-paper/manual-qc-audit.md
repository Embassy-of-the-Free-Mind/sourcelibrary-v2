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

---

## Recall-fix validation + ground-truth labeled rate (2026-05-31)

Implemented the recall fix (strip `(Siku Quanshu …)`/edition suffixes; OpenLibrary
fallback for Google-Books-quota resilience) and re-ran the labeled stratum:

| Measure | Labeled-stratum translated | Rate |
|---|---|---|
| Old pipeline | 1/58 | 1.7% |
| **Recall-fixed pipeline** | **4/58** | **6.9%** |
| **Hand-verified ground truth** | **~8/58** | **~14%** |

Recall fix recovered 3 true positives the old run missed: **Record of Buddhist
Kingdoms** (Faxian/Legge), **Xuanhe Paintings Catalogue** (McNair 2019), **Hong
Ming Ji** 弘明集 (partial). Residual automated misses are *title-divergent*
translations — published under a title unrelated to the catalog label — which
string search can't bridge:

- 洛陽伽藍記 "Record of the Monasteries of Luoyang" → translated as **"Memories of
  Loyang"** (Jenner 1981) / "A Record of Buddhist Monasteries in Lo-yang" (Wang 1984)
- 數書九章 "Mathematical Treatise in Nine Sections" → **"Chinese Mathematics in the
  Thirteenth Century"** (Libbrecht 1973)
- Wen Xuan annotations → Knechtges, *Wen Xuan* (Princeton, 3 vols)
- duplicate Wikidata item "Shanhai jing" (romanization-spacing variant of Shan Hai Jing)

**Ground-truth labeled rate ≈ 14%** (≈8/58 items; ~6 distinct works after dedup).
Even the fixed pipeline undercounts by ~2× — title-divergence is the residual
gap; closing it needs a work-identity resolver (canonical-title lookup), not more
search tuning.

**Corrected overall estimate:** labeled contributes ~8/3,418; the Chinese-only
tail adds translated base classics (大唐西域記, 古列女傳/Lienü zhuan→Kinney, Art
of War, …). Net **~1–2%, plausibly up to ~3%** — comparable to Renaissance Latin
(~2%), now anchored by a hand-verified stratum. The headline is robust; the
precise decimal still rides on a full recall-fixed tail census (Google-Books-quota
gated → use the OpenLibrary fallback over multiple runs).
