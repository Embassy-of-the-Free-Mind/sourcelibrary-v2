# PREREG: can gemini-3.1-flash-lite correct a GPU engine's draft? (#7263)

Committed before any paid call, 2026-10-24.

PRIOR ART: `scripts/eval/paddle-correct-6561/` (Chinese, Paddle draft; experiments
`2026-10-12-paddle-zh-correct-vs-redo-6561.md`, `2026-10-13-sonnet-haiku-correct-vs-opus-6667.md`) and
`scripts/eval/tibetan-correct-6560/` (Tibetan, Yigdzin draft; experiments `2026-10-12-tibetan-yigdzin-correct-vs-redo-6560.md`,
`2026-10-13-tibetan-flash38-correct-6560.md`). Their pages, drafts, references, planted errors, scorers and prompts are
reused unchanged; this test adds only the lite arms.

## Question

Given the GPU engine's draft AND the page image, does `gemini-3.1-flash-lite` correct the draft well enough to be a
correction route, per language? It is the cheapest corrector (paid Batch, about half the realtime price).

## Sets (rebuilt from what the earlier tests committed)

1. **Chinese, Paddle draft (#6561 sets).** `paddle-correct-6561/rebuild.mjs` from `results/draw.json`. Checked before
   this file was written: `score.mjs` over the committed outputs reproduces all 494 committed page CER values.
   - set A: 40 withheld table pages (the main Chinese set);
   - set B random: 30 ordinary Paddle pages;
   - set B disagree: 30 pages where Paddle and the stored second read differ (reported, secondary);
   - 10 planted-error drafts (30 plants) on set B random pages.
2. **Tibetan, Yigdzin draft (#6560 set).** `tibetan-correct-6560/prep.py --reuse-plants`: 30 Kangyur folios scored
   against the fixed Derge windows, 10 planted-error drafts (30 plants).
3. **Third language:** only if a scored correction set already exists (Syriac Kraken drafts, Chinese SKQS Paddle with
   Kanripo references). None is built here.

## Arms

- **lite-correct** (main): image + draft, one page per call.
- **lite-noimg-correct** (control): the same prompt bytes and draft, no image attached. Shows whether lite uses the
  image at all. Run on the same pages and plants.
- **lite-correct-r2** (noise floor): a repeat of lite-correct on 10 pages per language (seeded draw, seed 7263:
  Chinese 5 from set A + 5 from set B random; Tibetan 10 of the 30 folios).

Prompts:
- Chinese: the #6561 Gemini (agy) correct prompt byte for byte: live OCR v19.1 head + pilot addendum + `draftBlock` +
  reply format + the agy suffix ("The page image to transcribe is the attached file. …"). Built from the rebuilt Opus
  request by swapping the Opus suffix for the agy suffix; the runner refuses unless the agy suffix hashes to
  `results/prompt-ref.json` `agy_suffix_sha` and the head to `head_sha`.
- Tibetan: `prep.py` `CORR`, as sent to every arm of #6560, image attached.

Call settings, as production lite OCR (`scripts/batch/bulk-reocr-local.mjs` `OCR_GENERATION_CONFIG`): through
`scripts/lib/gemini-script-client.mjs` `callGemini`, `temperature 0.1`, `thinkingBudget 0`, `maxOutputTokens 16384`,
safety `BLOCK_NONE`. Realtime API for turnaround (same model and config as Batch); cost is reported at the Batch price
(half of `model-pricing.mjs` 0.25 / 1.50 per M tokens). One read per page; a transport error is retried, a reply is
never re-asked.

## Scores (the sets' own scorers, arms added; existing outputs unchanged)

- Chinese: CER against the Kanripo leaf (Han only, ditto folded), over-count, column-order jumps, better / worse
  pages (> 0.5 pt), anchoring (planted error kept / fixed). Added: paired Δ CER vs Paddle with a 95% bootstrap over
  books (4,000 draws), and a **wreck count**: pages with CER ≥ 50%, pages whose Han length exceeds Paddle's by > 25%
  (loops/duplication), and pages written as a markdown table.
- Tibetan: syllable identity vs Derge, Δ vs baseline [95% bootstrap over folios], folios better / worse, recall,
  folios returned unchanged, anchoring (planted errors left). Added: **wreck count**: folios with more lines than the
  draft + 2, or syllables > 115% of the draft's (duplication), or identity < 0.85.
- Noise floor: on the r2 pages, |Δ| between the two lite reads per page; pages returned identical.

## Bars, per language, against that set's own numbers (never pooled)

A language is a **route candidate** only if all three hold on its main set (Chinese: set A AND set B random each;
Tibetan: the 30 folios):

- **(a) better than the draft:** paired Δ vs the draft with its 95% interval excluding 0 in the improving direction.
- **(b) pages made worse ≤ Opus-correct's on that set:** Chinese set A ≤ 1/40, set B random ≤ 2/30; Tibetan ≤ 0/30
  (Opus made 0 worse). A worse page is the set's own definition (Chinese > 0.5 pt CER; Tibetan any identity drop).
  If the margin is within the r2 noise floor, say so.
- **(c) no damage:** Tibetan planted errors left ≤ Opus's 14/30, reported beside Flash low's 3/30; Chinese planted
  errors kept ≤ 3/30; wreck count 0 on the main set (one wrecked page is reported by eye and fails the bar unless it
  is a scorer artefact).

The no-image control is diagnostic, not a bar: if lite-noimg-correct does as well as lite-correct, lite is editing
from language priors, and the result is reported as such.

By eye: the 3 worst lite-correct pages per language (largest worsening vs the draft), looked at against the image by
a sealed `claude -p` Opus reader.

## Spend estimate

Chinese 110 pages × 2 arms + 10 repeats = 230 calls; Tibetan 40 × 2 + 10 = 90 calls; 320 calls. Chinese ≈ 7K input +
1K output tokens a call, Tibetan ≈ 4K + 3K. At realtime price about $0.9 total; at Batch price about $0.45. Hard cap
in the runner: 400 calls.
