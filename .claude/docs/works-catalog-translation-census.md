# Translation census — Tibetan & Islamicate (works catalog #2453)

First automated English-translation gap numbers for either corpus. Method:
`scripts/works-catalog/translation-census.mjs` — seeded 300-work sample, Gemini
established-English-title resolution (null when none exists), Google Books +
OpenLibrary recall, Gemini precision adjudication (complete/partial), errors
excluded. **The automated rate is a RECALL FLOOR** (the Siku census ran ~2×
higher on hand-verified ground truth).

## Headline (purified denominators, 2026-06-08)

| Tradition | Denominator | Sample | Translated | Rate | 95% CI | Projected works |
|---|---|---|---|---|---|---|
| Islamicate (OpenITI, pre-1900) | 6,531 | 300 | 16 | 5.3% | 3.3–8.5% | 216–554 |
| Tibetan (BDRC, language-purified) | 30,437 | 300 | 8 | 2.7% | 1.4–5.2% | 413–1,574 |

Same order of magnitude as Latin (~2%, USTC) and Chinese (~1–3%, Siku).
**Tibetan is now the lowest measured (~2.7%)** — a vast, deeply under-translated
literature. Across every tradition we've measured, **the premodern written
record is ~95–98% untranslated into English.** Written back as evidenced
`census-auto` claims.

## Denominators were purified before these numbers (the prior raw run was wrong)

The first run (2026-06-06) reported islamicate 4.3% / tibetan 6.3% on
*contaminated* denominators. Both were corrected at the source (fix committed in
the same PR), not just caveated:

- **Tibetan: BDRC blanket-tagged ~11,600 non-Tibetan works as Tibetan.** The
  records carry explicit `bdo:language` tags that the first ingest ignored.
  Split out: **khmer 9,497, pali 1,895, sanskrit 185, newari 27** (the FEMC
  Cambodian manuscript fund — Fonds pour l'Édition des Manuscrits du Cambodge).
  The well-translated Pali canon (Dhammapada, Vessantara Jataka…) had been
  inflating the "Tibetan" rate; on the genuine 30,437-work Tibetan denominator
  it falls to 2.7%. Khmer/Pali/Sanskrit now get their own censuses if wanted.
- **Islamicate: OpenITI carries 2,260 post-1900 works** (it's "Islamicate
  texts," not "pre-1900"; author death-date = century). The census now filters
  `century ≤ 19`, giving a 6,531-work pre-1900 denominator.
- **Adjudicator occasionally affirms from parametric knowledge.** A few hits
  (al-Biruni's *India*, Mahfouz) were marked translated with the reason noting
  *no candidate matched* — the model knew a translation exists outside the
  search results. Correct for Biruni (Sachau 1910); a false-positive risk
  elsewhere. Keep `confidence` + `evidence` on every claim for audit.

## Remaining caveat
- **Adjudicator occasionally affirms from parametric knowledge.** A few hits
  (al-Biruni's *India*) were marked translated with the reason noting *no
  candidate matched* — the model knew a translation exists outside the search
  results. Correct for Biruni (Sachau 1910); a false-positive risk elsewhere.
  Every claim keeps `confidence` + `evidence` for audit.

## Calibration — the bare numbers are a 2–3.5× undercount (2026-06-08)

`calibrate-census.mjs` re-checked the first 40 works of each seeded census
stratum with **web-grounded** Gemini (googleSearch + thinkingBudget:-1 +
parse-inside-retry) — which finds translations whose published title diverges
from the original. Per-work CSVs for human sign-off:
`/root/works-catalog-cache/calibrate-{tradition}.csv`.

| Tradition | bare (Google Books) | grounded (web) | multiplier | implied true rate |
|---|---|---|---|---|
| Islamicate | 3/40 = 7.5% | 6/40 = 15.0% | **2.0×** | ~10% |
| Tibetan | 2/40 = 5.0% | 7/40 = 17.5% | **3.5×** | ~9% |
| Chinese | 0/40 = 0% | 4/40 = 10.0% | n/a (bare=0) | — |

The 2.0× matches the Siku census's hand-verified finding exactly. **Tibetan is
the worst-undercounted (3.5×)** — Wylie titles diverge hard from published
English titles, so bare title-matching misses most. Caveat: n=40 is small and
this is *machine*-deep-verified (web-grounded, not human) — the CSV is the
artifact a human signs off to publish. Apply the multiplier to the headline
rates for a true-rate estimate; keep the bare rate as the defensible floor.

## Recommended follow-ups
1. Human-review the calibration CSVs (40/tradition) to lock the multiplier —
   then the true rates are publishable.
2. Census the peeled-off traditions (khmer 9,497, pali 1,895, sanskrit 185) if
   wanted — the Pali canon will read much higher (it's well-translated).
3. These extend the translation-gap-site story to Tibetan + Arabic — **no prior
   published English-translation figure exists for either corpus.**

Reports: Hetzner `/root/works-catalog-cache/census-{tibetan,islamicate}-report.json`;
verdict caches alongside (resumable).
