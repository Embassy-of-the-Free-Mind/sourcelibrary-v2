# Preregistration · #6871 row A — image gain as a guessed-text detector (committed before any span is scored)

PRIOR ART: arXiv 2605.27750 ("Reading or Guessing?", Karamolegkou et al.) — gain(t) = log p(t | image, prompt) − log p(t | prompt), teacher-forced, image removed; it reports paired median gain differences by error type on the model's OWN transcription (Greek, Arabic), no AUROC. The gex45 capability card (`2026-10-18-gex45-capability-card-6871.md`) ran the same pair for speed only. Nothing here has scored spans.

**Question.** On stored OCR reads (mostly Gemini 3 Flash preview), does the per-token image gain of an open VLM find the spans a sealed Opus adjudicator marked wrong, well enough to pre-screen pages before Opus review?

**What differs from the paper.** We score someone else's read (Gemini's), not the scorer's own decode. A low gain can then mean "the scorer would not write this" as well as "this was guessed".

## Data (frozen at commit)
- **Real set:** every page a lane B Opus adjudication judged (`scripts/batch/ocr-convergence/results/run/{calib,gate,main200b,q300}`, #6420 / #6694), stored read rebuilt by `build-set.mjs` (identity: `normaliseForCer(text).length == len_stored`; 2,183 of 2,183 recovered; 2,178 with ≥ 40 cleaned characters). Spans: `prep.py` — 5,622 error parts; 3,693 located, 481 not locatable, 568 omissions (nothing to score), 880 "other" (masked). Groups (the book's lane group): latin 1,022 pages · german 402 · chinese 356 · greek 257 · arabic 105 · hebrew 36.
- **Planted:** `plant.mjs`, 41 pages Opus judged clean (n_errors = 0): 21 with 3 fluent wrong words each (gemini-3.1-flash-lite proposals), 20 with one sentence from another page of the same book swapped in.
- Pilot: 20 pages run ONLY to check token alignment (20/20 aligned); their likelihoods were not scored for labels.

## Scorer
Qwen2.5-VL-7B-Instruct-AWQ on gex45 (vLLM 0.31, `/root/bench/vl`), prefix caching off, temperature 0, prompt_logprobs, the bench transcription prompt; image = archived master, long side capped at 2,400 px. No-image pass = the same messages without the image part. Text = the stored read minus `<detected-images>` / `<vocab>` blocks, first 8,000 characters. A page counts only if the scored token ids equal the tokenizer's ids for the text (both passes).

## Units and scores (`score.py`)
- Unit = a whitespace word with ≥ 1 letter; inside Han runs, 3-character chunks. Window = the unit's tokens, widened to ≥ 4 tokens.
- **gain** = windowed mean of log p(tok | image) − log p(tok | no image); flag LOW.
- **Baseline** = windowed mean of −log p(tok | no image) (text-only perplexity); flag HIGH.
- Label 1 = overlaps a located span of kind sub_char / sub_lexical / invented / garbled; masked if it overlaps an "other" quote; else 0. Opus lists are not exhaustive, so some 0s are errors: this lowers every scorer's AUROC alike.

## Metrics
- **Primary:** unit AUROC of gain on the real set, pooled and per group; 95% CI from 2,000 page-cluster bootstrap resamples (seed 6871); precision (and recall) at a 10% flag rate within the group, with the base rate.
- **Baseline comparison:** paired bootstrap of AUROC(gain) − AUROC(base) on the same resamples.
- **Secondary (descriptive):** planted set (all / word / sentence); by kind; pages where every error part located; −log p(tok | image) alone.
- **Noise floor:** 300 real pages (seeded, seed 6871) scored a second time in a later GPU hold (same settings), and once more at a long-side cap of 1,200 px. Report the unit-gain Pearson r and median |Δgain| against the main pass, and AUROC on those 300 under each pass.

## Bar (per group and pooled)
AUROC(gain) ≥ 0.75 on real spans **and** its CI excludes 0.5 **and** the paired CI of AUROC(gain) − AUROC(base) is above 0. A group with fewer than 30 positive pages gets no verdict.

## Decision rule
- Pre-screen before Opus review in a group only if that group clears the bar. The threshold is the gain at that group's 10% flag rate, reported with its precision.
- Otherwise the DECISION is no. If the bar fails but the planted set scores well, say so: that means the detector sees swapped-in text, not the errors Opus finds.
