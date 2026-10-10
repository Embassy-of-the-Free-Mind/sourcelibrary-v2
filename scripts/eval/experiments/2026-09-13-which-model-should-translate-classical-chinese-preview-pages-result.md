---
stage: translation
measure: judged
languages: [lzh]
scripts: [Hani]
canons: []
n_books: 60
n_pages: 60
verdict: "Lite and flash-preview are indistinguishable blind (27:26, p=1.0) at 2.2x the price; 2.5-flash is worse (17:33). Lite stays."
status: superseded
decision: null
superseded_by: "2026-09-14-which-model-should-translate-classical-chinese-preview-pages-six.md"
---
## 2026-09-13 — Which model should translate classical Chinese? (樂舞 preview pages) — RESULT (three arms; superseded by the six-arm read above, which re-judged these same translations)

**Headline: on 60 Chinese pages, `gemini-3.1-flash-lite` and `gemini-3-flash-preview`
are indistinguishable to a blind judge (27 : 26, p = 1.0) at 2.2× the price;
`gemini-2.5-flash` is worse (17 : 33, p = 0.033, 5/60 pages > 20 % untranslated).
Lite stays the route. The Chinese-lab arms were NOT run (no OpenRouter key) and
`gemini-2.5-flash-lite` is closed to new users (HTTP 404) — both recorded as skipped.**

- **Question / design.** As pre-registered below (same-day entry). n = 60 pages / 60
  books, production prompt v13 (hash 51651014…), no thinking, no previous-page
  context. Three Gemini arms delivered 60/60 each, zero refusals, $0.39 total.
- **Primary (blind ranking, 60 pages).** Mean rank lite 1.73, preview 1.72,
  2.5-flash 2.23; first place 29 / 32 / 15. Sign test vs lite: preview 27 W – 26 L –
  7 T (p = 1.000); 2.5-flash 17 – 33 – 10 (p = 0.033).
- **Co-primary (fabrication flags).** lite 19, preview 23, 2.5-flash 27 of 60 — no
  arm is eligible under the rule (fabrication ≤ lite's), so the rule returns lite.
  Paired: lite-only 14, preview-only 18, both 5, neither 23. The absolute rate is
  high because the judge flags ANY unsupported gloss or meta-note (e.g. an invented
  author in `<meta>`, an unsupported "Coromandel" gloss for 西洋); the ORDER is the
  signal, and it favours lite weakly.
- **Judge reliability (second pass, 20 pages re-shuffled).** Arm-vs-lite direction
  agreed 24/40 (60 %); same first place 11/20; mean Spearman ρ 0.42; fabrication
  flags identical 39/60. **The judge cannot reliably separate lite from preview**;
  it does separate 2.5-flash (omission 17 vs 9, untranslated residue 5 % vs 0.3 %).
  n = 60 is powered for a large effect only — read "no large difference", not "equal".
- **Reference-free.** Preview writes 9 % more prose and leaves 0 CJK residue; lite
  0.3 %; 2.5-flash 5 % (5 pages > 20 % untranslated, tables left as raw Chinese).
  `verified-note rate` 0.79 / 0.02 / 1.00 is a citation-FORMAT artefact: preview
  writes `original: "Zuo Zhuan"` in pinyin, which the verbatim verifier cannot
  match; it is not fabrication (instrument note now in the report).
- **Cost, measured.** $0.0017 / $0.0037 / $0.0012 per page realtime → 樂舞 20K pages
  ≈ $34 / $73 / $24 (batch halves it).
- **Recommendation.** Run 樂舞 on lite. What would change it: an OpenRouter key on
  Hetzner (`--run` resumes; the DeepSeek/Qwen/GLM arms cost ≈ $1.55) and a judge with
  better test-retest (a stronger model, or two independent judges per page) before
  trusting any preview-vs-lite call at this n.
- **Replicated?** No. k = 1 per (page, arm); judge pass 2 is the only repeat.
- **Artifact.** `results/translation-model-ab-zh-report.md` (+ .json, arms, score,
  packets, keys, verdicts ×2); harness `translation-model-ab.mjs`; judge prompt
  `translation-model-ab-JUDGE-PROMPT.md`.
