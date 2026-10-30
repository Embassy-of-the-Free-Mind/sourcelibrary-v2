# Defect-rate routing rule, preregistered (#6740, job defect-rate-6740)

Written and committed **before** any route's defect rate was computed and before any comparison against the router
table. At this commit, the inventory (`defect-rate.mjs inventory`) has run, so this much is known: which verdicts
exist, how many rows have their own candidate text, and what a few planted rows look like. No rate, posterior or
decision has been computed. Nothing here switches a live route: the output is a proposal for Derek.

## Measure

- **Unit:** defects per 1,000 words of the candidate text the judge read. Every defect the judge tagged counts at its
  own severity: `cosmetic`, `misleads` or `wrong_text`.
- **What a word is.** Non-content tags are dropped with their content (scan-quality, language, script, page-type,
  page-num, meta, note, image-desc). Other tags are dropped and their content kept. Then a word is:
  - a whitespace token with a letter or digit;
  - in Chinese and Japanese, one Han character;
  - in Tibetan, one syllable.
- **Rates compare within a script, never across scripts.**
- **Items only.** Wrong-page controls and planted items are left out, and so are drafts that were judged only because
  their correction was rejected (lane-accept-7263 `lite`). The study cells are reported as they ran. In the router
  cells, a verdict that two runs share (the same page and the same text) counts once.
- **A row with no text of its own** takes its page's size from another stored text of the same page (`words_src: page`).
  A row with no text at all is left out of the rates and counted in the coverage.

## Rate model (per router base cell × route × severity)

- **Data.** k = defects of that severity over the route's item pages. E = thousands of words on those pages.
- **Overdispersion.** Defects cluster in books, so they are scaled by φ = max(1, Pearson X² / (B − 1)), taken over
  the B books (book counts against E_b·λ̂), when B ≥ 5. Otherwise φ is the median φ of that task and severity. The
  model uses k/φ and E/φ (quasi-Poisson).
- **Pooled prior.** Gamma(α, β) for each task (OCR or translation) and severity. It is fitted by maximum marginal
  likelihood (negative binomial) over every rated router (cell, route) group of that task, on the φ-scaled counts.
- **Power-prior discount.** a0 = min(1, 2 / β), so the prior never weighs more than **2,000 words** (about 5 to 7
  pages), whatever the pooled fit says. Prior Gamma(a0·α, a0·β). Posterior Gamma(a0·α + k/φ, a0·β + E/φ).
- **Interval.** A by-book bootstrap of the ratio Σk / ΣE (2,000 resamples, seed 6740) is reported beside it, as a
  check that does not depend on the model.

## Decision rule

1. **Candidates.** Each router row of the live table (`current.json` → `2026-10-30-german-cheaper-7701`) keeps the
   table's own convention:
   - In print and unknown cells, Opus is the bar and never a candidate (switch.bar = opus, bar_scope = print).
   - In manuscript cells, every route is a candidate.

   A route is **rated** when it has at least 10 item pages with words in this inventory. Only rated routes can be
   picked.
2. **Wrong text is a hard gate.**
   - **Bar route:** the rated Opus route with the lowest posterior mean wrong-text rate. If no Opus route is rated,
     or the row is a manuscript row, the bar is the rated route with the lowest posterior mean.
   - A candidate **passes** when its posterior mean wrong-text rate is at most the bar's plus **δ = 0.15 per 1,000
     words**.
   - Why 0.15: it is the table's own relative bar (best route + 4 points of wrong-text pages), restated per word at
     the corpus's typical 300-word page with one wrong-text defect per such page. P(λ_route ≤ λ_bar + δ) is reported
     beside it.
3. **Expected cost per raw page** = price + (W / 1,000) × (w_m · E[λ_misleads] + w_wt · E[λ_wrong_text] + w_c · E[λ_cosmetic]).
   - W = the cell's median words per page over all its rated routes' texts.
   - **w_c = 0.** No reader is misled.
   - **w_m = $0.01 per misleading defect.** The costliest route the router runs today, an Opus image correction on
     the subscription, costs about $0.002 a page. At list API it costs $0.082. So $0.01 says this: avoiding one
     misleading defect is worth about 5 subscription Opus corrections, and more than the whole price gap between any
     two agy or GPU candidates (≤ $0.002 a page). It is worth about 1/8 of a list-price correction. The weight is a
     value judgment, so it gets a sensitivity at **$0.001 and $0.1**, and every cell reports its **break-even w_m**:
     the weight at which its pick changes.
   - **w_wt = 3 × w_m.** This applies to routes that have already passed the gate, so of two routes that pass, the
     one with less wrong text still costs less.
   - **Price** = build.py `usd_per_page` on the table route's units:
     - Claude points × $200 × 12 / 52 / 100 per point;
     - agy calls × 4.45e-6 × $200;
     - a made draft costs 0.

     This is the default plan fee, the table's convention. No private fee file is used.
4. **Pick.** The passing candidate with the lowest expected cost.
   - If no candidate passes, or no candidate is rated, the row **keeps** its current route.
   - If the current route is not rated, the row reports "not comparable: current route has no defect verdicts",
     together with what the rule would pick among the rated routes.
5. **Comparison.** For every row, the current table's decision (k/n rule) sits beside the new rule's at
   w_m = $0.001, $0.01 and $0.1. The cells the brief names come first:
   - German read@8, and LightOnOCR > agy@4 (german-blank);
   - Latin arm c;
   - the English pre-1800 test;
   - French read@4.

## Positive control (reported first)

- **Planted items** come from judge-planted-7611 (Latin, German and French; B number, C noun swap, D line dropped,
  E sentence inserted), the router tests' planted items (cheap-routes, german-cheaper, en-pre1800), the Tibetan
  planted syllables (pilot and tib-kangyur) and the lane sampler's planted controls.
- **Hit:** a defect whose quote contains the planted span, after whitespace and long-s folding:
  - B, C and E: the planted text (`after`). For E, an overlap of at least 12 characters with the inserted sentence
    is enough.
  - D: at least 12 characters of the dropped line (`before`), or the planted context on both sides of the gap.
  - Tibetan: judge.mjs `caught()`, the planted syllable together with a neighbouring syllable.
- Reported: the hit rate with Wilson 95% intervals, the severity of the defect that hit, and the rejection rate.
  **Bar: 0.80.**
- **Where the control fails, that language's per-word rates are flagged as a floor, not a rate.**

## Correction passes (defects introduced)

- **Pairs.** For each (draft, draft > corrector) pair on the same page in the same run, where both texts are held:
  - A misleads or wrong_text defect on the CORRECTED text is **introduced** when its quote occurs in the corrected
    text but not in the draft (whitespace-folded).
  - A draft defect is **removed** when its quote does not occur in the corrected text.
- Reported per corrector × cell: introduced and removed per 1,000 words, with by-book intervals, and the class mix of
  what was introduced. The word swap ("seventh" → "nine") is O6/O7/T8.
