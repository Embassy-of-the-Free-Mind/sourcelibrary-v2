# Translation census — Tibetan & Islamicate (works catalog #2453)

Run 2026-06-06 on Hetzner. First automated English-translation gap numbers for
either corpus. Method: `scripts/works-catalog/translation-census.mjs` — seeded
300-work sample, Gemini established-English-title resolution (null when none
exists), Google Books + OpenLibrary recall, Gemini precision adjudication
(complete/partial), errors excluded. **The automated rate is a RECALL FLOOR**
(the Siku census ran ~2× higher on hand-verified ground truth).

## Headline (raw, as-sampled)

| Tradition | Denominator | Sample | Translated | Rate | 95% CI | Projected works |
|---|---|---|---|---|---|---|
| Islamicate (OpenITI) | 8,791 | 300 | 13 | 4.3% | 2.5–7.3% | 224–639 |
| Tibetan (BDRC) | 42,041 | 300 | 19 | 6.3% | 4.1–9.7% | 1,720–4,069 |

Written back as `census-auto` claims: islamicate 10 full + 3 partial, tibetan
18 full + 1 partial. Same order of magnitude as Latin (~2%, USTC) and Chinese
(~1–3%, Siku): **the vast majority of the premodern written record in every
tradition we've measured has no English translation.**

## Denominator-purity caveats (READ before quoting a per-tradition rate)

Both raw rates are inflated by corpus contamination — the diligence lesson from
the Siku census applies. Surfacing, not hiding:

- **Tibetan: 9 of the 19 hits are not Tibetan.** BDRC includes 11,392 FEMC
  records (`*FEMC*` ids = Fonds pour l'Édition des Manuscrits du Cambodge —
  Pali/Khmer palm-leaf manuscripts). The well-translated Pali canon (Dhammapada,
  Anattalakkhana Sutta, Vessantara Jataka, Abhidhammattha-sangaha…) lands in
  this sample and lifts the rate. **Genuine Tibetan-only rate is roughly half
  the headline** (~3–4%), and several remaining hits are Indic Mahayana sutras
  preserved *in* Tibetan (Perfection of Wisdom, Uttaratantra) — translated from
  the Sanskrit/Tibetan, i.e. canon, not the indigenous Tibetan corpus.
- **Islamicate: 2,260 of 8,791 works (26%) are post-1900.** OpenITI is "texts
  of the Islamicate world," not "pre-1900." 2 of 13 hits are Naguib Mahfouz
  (d. 2006) novels. Filtered to pre-1900 the rate is marginally lower and the
  denominator drops to ~6,500.
- **Adjudicator occasionally affirms from parametric knowledge.** A few hits
  (al-Biruni's *India*, Mahfouz) were marked translated with the reason noting
  *no candidate matched* — the model knew a translation exists outside the
  search results. Correct for Biruni (Sachau 1910); a false-positive risk
  elsewhere. Keep `confidence` + `evidence` on every claim for audit.

## Recommended follow-ups
1. **Purify denominators before publishing per-tradition rates:** split FEMC
   into a `pali` / `khmer` tradition; add a `pre-1900` filter (century ≤ 19) to
   the Islamicate denominator. Then re-report.
2. Hand-verify a labeled stratum (≥30 works/tradition) to calibrate the
   recall-floor multiplier, as done for Siku.
3. These are the publishable gap numbers — once purified, they extend the
   translation-gap-site story to Tibetan + Arabic (no prior published figure
   exists for either).

Reports: Hetzner `/root/works-catalog-cache/census-{tibetan,islamicate}-report.json`;
verdict caches alongside (resumable).
