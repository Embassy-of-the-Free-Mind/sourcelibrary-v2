---
stage: translation
measure: judged
languages: [lzh]
scripts: [Hani]
canons: []
n_books: 60
n_pages: 60
verdict: "No arm displaces lite: preview beats it blind (31-16, p=0.040) at 2.2x cost; Chinese-lab arms write less; the judge's test-retest is only 52%."
status: rejected
decision: "Lite kept for the Chinese ritual-dance books; pre-registered rule applied as written"
superseded_by: null
---
## 2026-09-14 — Which model should translate classical Chinese? (樂舞 preview pages, SIX arms) — RESULT

**Headline: no arm displaces `gemini-3.1-flash-lite`. `gemini-3-flash-preview` is the
only arm that beats lite blind (31 W – 16 L – 13 T, p = 0.040) and it costs 2.2×, so
the pre-registered rule keeps lite. The Chinese-lab arms are cheaper but write LESS:
DeepSeek v4.1-flash leaves 16 % of the page in Chinese (12/60 pages > 20 % untranslated)
and emits no house-format notes at all; Qwen3.8-flash is the worst-ranked arm and
invents tags on 0.8 tags/page. And the judge's own test-retest is 52 % — a coin flip —
so read every ranking here as weak.**

- **Question / design.** As pre-registered below. Same n = 60 pages / 60 books, same
  production prompt v13 (hash 51651014…), no thinking, no previous-page context. Six arms
  delivered: lite (baseline), gemini-3-flash-preview, gemini-2.5-flash,
  deepseek-v4.1-flash, qwen3.8-flash, deepseek-v4-pro-0813 — 60/60 each except
  deepseek-v4-pro (59, one empty reply). $0.62 spent on translation, judging on subscription.
- **Skipped, recorded not failed.** `z-ai/glm-5.3-flash` and `qwen/qwen3.8-max-0902`
  refuse `reasoning.enabled=false` ("Reasoning is mandatory for this endpoint", HTTP 400);
  a reasoning-on run of both was delivered ($0.86) and is preserved UNJUDGED in
  `results/translation-model-ab-zh-arms-reasoning-excluded.jsonl` — judging it would have
  compared a thinking model against five non-thinking ones. `gemini-2.5-flash-lite`: HTTP 404,
  closed to new users.
- **Primary (blind ranking, 60 pages, 6 labels/page, fresh shuffle seed 20260914).**
  Mean rank / first place: preview 2.30 / 28, deepseek-v4.1-flash 2.85 / 26, lite 3.07 / 19,
  deepseek-v4-pro 3.37 / 21, 2.5-flash 3.45 / 17, qwen3.8-flash 3.60 / 12. Sign test vs lite:
  preview 31–16–13 (p = 0.040), deepseek-v4.1 28–18–14 (p = 0.184), deepseek-pro 24–26–9
  (p = 0.888), 2.5-flash 21–31–8 (p = 0.212), qwen 20–30–10 (p = 0.203).
- **Co-primary (fabrication).** deepseek-v4.1 14, deepseek-pro 16, preview 21, lite 22,
  2.5-flash 28, qwen 31 of 60. Eligible (refusals ≤ lite + 4 AND fabrication ≤ lite's):
  preview, deepseek-v4.1, deepseek-pro. **A low fabrication count is not free here** —
  deepseek-v4.1 writes 378 fewer chars/page than lite, emits 0.00 notes/page against lite's
  0.93, and leaves 16.4 % of the page as untranslated Chinese (lite 0.3 %): it asserts less
  because it says less, and its omission count is higher (16 vs 13).
- **Judge reliability (second pass, 20 pages, labels re-shuffled).** Arm-vs-lite direction
  agreed on 52/100 comparisons (**52 %**, chance ≈ 50 %); same first place 14/20; mean
  Spearman ρ 0.50; fabrication flags identical 86/120 (72 %). The three-arm read below put
  preview at 27–26 (p = 1.000) on the SAME translations; this six-arm read puts it at 31–16
  (p = 0.040). That swing between judging passes, not a change in the models, is the finding
  to carry: **a Sonnet judge cannot carry a p-value on this task at this n.** Fabrication
  flags and the mechanical measures are the sturdier signal.
- **Reference-free (per delivered page).** Untranslated CJK share: preview 0.000, lite 0.003,
  2.5-flash 0.050, qwen 0.057, deepseek-v4.1 0.164, deepseek-pro 0.197 (pages > 20 %
  untranslated: 0 / 0 / 5 / 5 / 12 / 13). House format: notes/page 1.13 preview, 0.93 lite,
  0.62 2.5-flash, 0.37 qwen and deepseek-pro, 0.00 deepseek-v4.1; invented tags/page 0.00
  lite and preview, 0.82 qwen. `verified-note rate` stays a citation-FORMAT measure (preview
  writes pinyin), not a fabrication measure.
- **Cost, measured (realtime; Gemini batch halves it).** $/page → 樂舞 20K pages:
  qwen3.8-flash $0.0005 → $11, deepseek-v4.1 $0.0010 → $19, 2.5-flash $0.0012 → $24,
  **lite $0.0017 → $34**, deepseek-pro $0.0024 → $48, preview $0.0037 → $73. OpenRouter arms
  are provider-reported charges; Gemini arms are list price × tokens.
- **Recommendation (rule applied as written).** Run 樂舞 on `gemini-3.1-flash-lite`. The rule
  recommends the cheapest arm that beats lite at ≤ 2× its price; preview beats lite but costs
  2.2×, and lite's fabrication gap over it is 1 page, far under the 5-page override. Named but
  NOT recommended: deepseek-v4.1-flash is cheaper (0.6× lite) with a better mean rank and lower
  fabrication at p = 0.184 — its untranslated residue disqualifies it for production as-is,
  but a residue-fixing prompt tweak plus a stronger judge is the run that would settle it.
- **What would change the answer.** A judge with real test-retest (a stronger model, or two
  independent judges per page with disagreements adjudicated) before any preview-vs-lite call;
  n = 60 is powered for a large effect only.
- **Replicated?** Partly, and it did NOT replicate: three Gemini arms were judged twice
  (three-arm read below, six-arm read here) and the preview-vs-lite verdict flipped from
  p = 1.000 to p = 0.040. Treat both as one weak read, not two.
- **Artifact.** `results/translation-model-ab-zh-report.md` (+ .json, arms, score, packets,
  keys, verdicts ×2; the three-arm pass kept as `…-3arm-judge-{key,verdicts}*`); harness
  `translation-model-ab.mjs`; judge prompt `translation-model-ab-JUDGE-PROMPT.md`.
