---
stage: translation
measure: none
languages: [lzh]
scripts: [Hani]
canons: []
n_books: 60
n_pages: 60
verdict: "Pre-registration: nine-arm blind-ranking comparison on 60 classical Chinese pages with a fixed decision rule that keeps lite unless an arm beats it cheaply."
status: informational
decision: null
superseded_by: null
---
## 2026-09-13 — Which model should translate classical Chinese? (樂舞 preview pages, N-arm) — PREREGISTRATION

_Written before the paid run; the result entry goes above this one when it exists.
Handoff: ops repo `handoffs/2026-09-13-zh-translation-model-ab.md` (+ amendment); research:
ops repo `docs/improvement-research-2026-09-11-data/trackA3-chinese-translation-models.md`._

- **Question.** The 136 ritual-dance (樂舞) books (~20K pages) await full translation.
  Production routes all non-BPH translation to `gemini-3.1-flash-lite` (#4762) on price,
  not on any Chinese measurement — none exists (only OCR numbers). Which model, among
  the cheap Gemini tiers and the Chinese-lab models, gives the most faithful English per
  dollar on THESE pages? Derek: "is it best to use flash-lite on chinese or qwen or
  another model, do we know?" / "doesn't need to be qwen — could be deepseek or another
  chinese model".
- **Design.** Paired over arms, SAME production translation prompt (whatever
  `is_default` resolves to; no v15 arm — a model comparison, not a prompt one), no
  thinking (`thinkingBudget: 0` / `reasoning.enabled=false`), no previous-page context.
  **n = 60 pages from 60 books, one page per book**, interior (page_number > 3), ≥ 150
  CJK chars of `ocr.data`, drawn by seeded shuffle from the 136-book list
  (`results/translation-model-ab-zh-books.txt`; sample pinned in `-sample.json`).
  Harness `scripts/eval/translation-model-ab.mjs`.
  Arms (baseline first): `gemini-3.1-flash-lite`, `gemini-3-flash-preview`,
  `gemini-2.5-flash`, `gemini-2.5-flash-lite`; via OpenRouter (`OPENROUTER_API_KEY`):
  `deepseek/deepseek-v4.1-flash`, `qwen/qwen3.8-flash`, `z-ai/glm-5.3-flash`,
  `deepseek/deepseek-v4-pro-0813`, `qwen/qwen3.8-max-0902`. **An arm whose key is absent
  is recorded as SKIPPED — a result, not a failure** (no OpenRouter key exists on Hetzner
  as of writing; a later `--run` with the key adds those arms without re-spending).
  Every arm is written to `-arms.jsonl` with refusals kept as rows.
- **Primary outcome.** Blind RANKING of all delivered translations per page by Sonnet
  lean-worker judges (labels T1..Tk shuffled per page, key in a separate file; ties
  allowed as grouped ranks; ≤ 3 pages per dispatch, ≤ 8 concurrent; prompt
  `translation-model-ab-JUDGE-PROMPT.md`: fidelity → omission → term consistency →
  readability last). Per arm: mean rank; **vs baseline: pages ranked above lite minus
  pages ranked below, exact two-sided sign test.**
- **Co-primary.** Judge fabrication flag per arm (something asserted the Chinese does
  not say — the disqualifier for classical text). Also omission and terms-ok flags.
- **Secondary.** Refusals per arm (HTTP error / blocked / RECITATION-class finish /
  empty body) as a ROW, never dropped; reference-free table per arm —
  `scoreTranslation` fields (notes emitted, verified-note rate, inline terms, invented
  and housekeeping tags, glossary blocks), English chars per CJK char, untranslated CJK
  residue share of the prose (citations inside `<note original>`/`<term>` excluded),
  pages > 20 % untranslated; measured $/page per arm (OpenRouter's reported charge
  where available, list price otherwise). Second judge pass over the first 20 pages,
  labels re-shuffled: arm-vs-lite direction agreement, same-first-place rate, mean
  Spearman ρ, fabrication-flag agreement.
- **Decision rule (fixed now).** *Eligible* = refused at most 4 more pages than lite
  AND fabrication-flagged on no more pages than lite. *Beats lite* = eligible AND ranked
  above lite on more pages than below AND sign-test p < 0.05. Recommend the CHEAPEST
  arm that beats lite and costs ≤ 2× lite per page; a dearer winner only if lite is
  fabrication-flagged on ≥ 5 more pages than it. If nothing beats lite: **lite**, unless
  a cheaper eligible arm has a mean rank at least as good as lite's (p ≥ 0.05) or an
  arm leads lite at p < 0.2 — then **undecided**, and the report names the run that
  would settle it (120 more pages, ≈ the two arms' $/page × 120). n = 60 is powered
  for a large effect only (sign test 60 pairs detects ~65:35); a null is "no large
  difference", not "equal".
- **Cost cap.** `--max-usd 2` enforced by the harness (`--dry-run` prints the estimate
  and exits 2 above it). Estimate for the four keyed Gemini arms: $0.58; all nine arms
  would be ≈ $2.13, so the OpenRouter arms are a second `--run` under their own cap.
  Nothing is written to Mongo; the 136 books stay at preview posture.
- **What would falsify the premise.** If lite is not last on fabrication and no cheaper
  arm ties it, the price-list routing was right for Chinese and the 樂舞 run goes to
  lite unchanged.
