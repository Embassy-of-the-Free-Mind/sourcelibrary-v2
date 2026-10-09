---
stage: ocr
measure: accuracy
languages: [en, la, de, grc]
scripts: [Latn, Grek]
canons: []
n_books: null
n_pages: 383
verdict: "olmOCR-2-7B-FP8 beats flash-lite on English 1600-1699 (CER 0.036 vs 0.053, routes to box) but keeps lite elsewhere; Greek catastrophic on 55 of 114 pages."
status: undecided
decision: null
superseded_by: null
issue: 5660
---
## 2026-10-03 (later), the second open engine: olmOCR-2-7B-FP8 passes English 1600–1699 and loses every other cell (#5660, job olmocr-5660b)

**Design.** Same 632 JPEGs, same `cells.json`, same `benchmark-score.mjs`, same `open-engine-markup@1` rule (unchanged: it touched 22 olmOCR pages), and the same `benchmark-cost-lane.mjs --cells` rule. Prompt, weights and settings were fixed in **Amendment 1** of the prereg (commit ea04d2aab, pushed before any scoring). The engine is `allenai/olmOCR-2-7B-1025-FP8` (HF snapshot `40bd7202…`) on vLLM 0.10.2 (torch 2.8.0, transformers 4.57.6). It used olmOCR's own v4 YAML prompt, temperature 0, 4,500 max tokens, pages at 1,288 px on the longest side, and 8 clients, on one RunPod SECURE RTX PRO 4000 Blackwell. It was scored in a separate bench root without Paddle's outputs, so `invention` is measured against the same other-engine set Paddle faced. Artifacts: `scored-olmocr/`, `cost-lane-olmocr.json`, `summary-olmocr.json`, `weak-spots-olmocr.json`, `olmocr-arm-run.json`.

| cell | n (library + external) | lite CER | olmOCR CER | median Δ [95% CI] | olmOCR W/L/T | catastrophic olmOCR vs lite | invention olmOCR vs lite | loops | verdict |
|---|---|---|---|---|---|---|---|---|---|
| English 1600–1699 | 59 (59 + 0) | 0.053 | **0.036** | **−0.014** [−0.024, 0.000] | 35/19/5 (p = 0.04) | 0 vs 3 (3 lite refusals) | 0.043 vs 0.171 | 0 vs 0 | **route to box** (all checks pass). Answered pages only (56): Δ −0.007, catastrophic 0 vs 0 |
| English 1700+ | 106 (106 + 0) | 0.022 | **0.002** | −0.015 [−0.019, −0.012] | 98/6/2 | 2 vs 21 (21 lite refusals) | 0.002 vs 0.018 | **1 vs 0** | **keep lite** by the rule: it fails only the loop check, on 1 page (by-eye 3). Answered only (85): Δ −0.012, catastrophic 2 vs 0 |
| Latin 1500–1699 | 36 (15 + 21) | 0.067 | 0.066 | +0.003 [−0.012, +0.008] | 15/19/2 | 1 vs 2 | 0.14 vs 0.23 | 0 vs 0 | directional (15 library): a tie |
| Latin 1700+ | 39 (0 + 39) | 0.007 | 0.019 | +0.008 [+0.002, +0.012] | 8/28/3 | 1 vs 2 | — | 0 vs 0 | directional (external only), lean: keep lite |
| German (21 Fraktur) | 29 (0 + 29) | 0.005 | 0.026 | +0.016 [+0.007, +0.026] | 4/25/0 | 1 vs 0 | — | 0 vs 0 | directional (external only), lean: keep lite |
| Greek print | 114 (114 + 0) | 0.145 | 0.480 | +0.287 [+0.200, +0.369] | 1/113/0 | **55** vs 1 | 0.73 vs 0.24 | 2 vs 0 | **keep lite** |

- **Noise floor** Δ₀ = 0.000 in every cell, as for Paddle.
- **Agreement strata** (agreement with lite; flash-preview vs lite in brackets): `latin-pre1700` 0.933 (0.955), `latin-1700s` 0.932 (0.977), `german-fraktur` 0.942 (0.985), `longs-en-fr` 0.933 (0.962). Agreement is not accuracy, and by-eye 5 shows olmOCR disagreeing with lite where *lite* is wrong.
- **Long-s (#4877), descriptive** (`weak-spots-olmocr.json`). On EEBO-TCP's 73 pages, words with ſ misread as f number **13** for olmOCR, against 1,030 for lite (1,092 on the repeat) and 1,261 for Paddle. olmOCR writes no ſ; it transcribes ſ as s. The scorer folds ſ→s, so this costs no engine anything. On `latin-pre1700`, abbreviation marks: olmOCR 217, lite 206, flash 300. Ligature glyphs: 46 vs 169.
- **Five pages read by eye (`read-from-image`, Claude reading the JPEG):**
  1. **Long-s, English 1600–1699:** EEBO *Jew of Malta* (ed-6a08fd…-p27; olmOCR 0.111, lite 0.105). olmOCR reads ſ correctly ("rests", "sleepe", "Treasure") where lite writes f ("refts", "fleepe", "Treafure"). It misreads the running head "The Iew of Malta" as **"The Law of Malice"**, and reads "Hast thou't" as "Hark thou't" and "fit so sadly" as "fit to lady". It also smooths a line-break into "my felicity and strength to my soul". These are plausible-English substitutions, not garble, and are the same in kind as Paddle's "Law of Malta". Net: a near-tie on this page, with different failure kinds.
  2. **Silent omission, English 1700+:** *Dictionary of Buddhism* glossary (en-6ab245-pg35895p272; olmOCR 0.911, lite 0.008). olmOCR transcribes only the two-line preface paragraph faithfully, then stops (`finish: stop`, 97 tokens). It drops the entire glossary, about 90% of the page, with no error signal. Lite reads it all.
  3. **Loop, English 1700+:** *Ethics of Maimonides* bibliography, Hebrew and Yiddish titles (en-6aa1d5-ws52). olmOCR reads entries 3–4 with Hebrew errors ("ספר זה צדק" for "ספר הין צדק"), drops "Salomon, Gotthold" and then loops on the leader dots "... ... ..." to the 4,500-token cap, losing entries 6–11. This is the one loop that fails the English 1700+ rule. Lite reads the Hebrew.
  4. **Greek, the worst Greek page:** Kühn's Galen (greek-4fd5df-p390; olmOCR CER 1.0). The page has the Greek text over a Latin translation. olmOCR transcribes **only the Latin block**, faithfully (one slip, "devouraverint"), and **drops every Greek line**. It does not fabricate text. It drops the Greek; Paddle wrote Modern-Greek-shaped nonsense. 36 of olmOCR's 42 length-capped pages are Greek.
  5. **Largest disagreement with lite on the long-s stratum:** *Salmon's* 1690s medical text, two columns (longs-en-fr-84dace-p128; agreement 0.25). **olmOCR is right and lite is wrong.** olmOCR reads column 1 then column 2 with ſ→s ("Posset", "six"; one slip, "given to fix Grains"). Lite **splices the two columns line by line** ("ly equalled my Catharticum fuccefs, even in this cafe.") and writes f for ſ throughout. flash-preview agrees with olmOCR's order.
- **Throughput and cost.** 632 pages, 0 errors, 1,715.5 s with the server already up: **2.71 s/page** at 8 clients, which is 2.8× Paddle's 0.96. 42 pages ran to the 4,500-token cap (36 Greek, 4 Wikisource, 1 English, 1 Fraktur). They took 30% of client time (4,035 of 13,616 s). None of the 42 is in English 1600–1699. On the GEX45 ($249/mo) that is **$0.26 per 1,000 pages**, against lite's $0.90 realtime and $0.45 on Batch (generic prompt). Install took 191 s, and download plus load 100 s, on the venv recipe in Amendment 1.
- **The cell that passed, in backlog terms.** English 1600–1699 books with `pipeline_next.step = ocr` (year from `year`/`published`, measured 2026-10-03): **145 books, 39,412 pages without OCR**. At 2.71 s/page that is **≈ 29.7 box-hours (≈ 1.2 box-days)**. That is ≈ $10 of a GEX45-month, against ≈ $18 (Batch) to $35 (realtime) on lite. The money is trivial either way. The case for routing is quality: fewer catastrophic pages, a quarter of lite's invention, and long-s read as s instead of f.

**Deviations.**
1. The `report` and `tally` glue gained `--scored`, `--summary` and `--weak` options (output paths only), so the olmOCR scoring does not overwrite Paddle's files.
2. olmOCR ran with one attempt at temperature 0. Its own pipeline retries at rising temperature and checks rotation, which would lift some of the 42 capped pages and cost more time. That was not tested.
3. The driver deliberately wrote nothing to the Hetzner watchdog's progress dir. The pod was the positive control for the watchdog fix (#5749), which kept it on GPU utilisation alone.
4. The dashboard was not regenerated (landing rule 3 deferred, as for Paddle).

**Implication.** olmOCR-2 is the first open engine to beat lite on a decision-grade cell: **English 1600–1699 routes to the box** under the preregistered rule. On English 1700+ it is better on 98 of 106 pages and never refuses, but the rule keeps lite there because of one loop. Two by-eye failures need a guard before any olmOCR lane ships:
- **Silent truncation**, a clean `stop` after 10% of the page (by-eye 2).
- **Script dropping** on mixed pages (Hebrew, Greek: by-eye 3, 4).

Both are detectable without a reference, by output length against lite's or by script share against the page. They must be a gate, not a hope. Greek stays on lite (55 catastrophic). Latin and German stay directional, tied or leaning lite. A decision-grade Latin cell still needs ≥ 50 library references (#5126).

**Replicated?** No. olmOCR ran once. **Cost:** GPU $0.345 (pod 0mgwwvbjosreyy, 36 min, terminated and confirmed gone) plus the $0.06/h negative-control CPU pod (52 min, ≈ $0.05). Gemini: $0.
