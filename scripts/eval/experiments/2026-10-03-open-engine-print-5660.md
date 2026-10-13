---
stage: ocr
measure: accuracy
languages: [la, de, en, grc]
scripts: [Latn, Grek]
canons: []
n_books: null
n_pages: 383
verdict: "PaddleOCR-VL-1.6 routes no print cell to the box: worse than flash-lite on Latin, German and early English, catastrophic on Greek print (58 of 114)."
status: rejected
decision: "Latin-script and Greek print backlog stays on flash-lite; no routing change (DECISIONS.md, #5660)"
superseded_by: null
issue: 5660
---
## 2026-10-03 — Can an open engine on our own GPU replace flash-lite for the Latin-script and Greek print backlog? PaddleOCR-VL-1.6: no, in every cell (#5660)

PRIOR ART: 2026-09-18-is-paddleocr-vl-1-6-an-acceptable-cost-lane-4925.md (the same engine and the same cost-lane rule, adopted for Chinese brush manuscript; never run on Latin-script or Greek print); 2026-10-01-early-english-ocr-accuracy-against-eebo-tcp-5488.md and 2026-09-28-is-flash-lite-adequate-on-modern-english-print-or-5216.md (the references reused here, lite and flash only); 2026-09-21-which-engine-should-read-greek-print-per-period-4925.md (Greek print, Kraken vs lite vs flash).

**Question.** Should the standing GPU box take the ≈ 8.3M-page print OCR backlog (Latin 6.9M, German 0.64M, English 0.51M, Greek 0.34M) with an open engine, or should Gemini flash-lite keep it (≈ $7K)? The answer is given per cell, against references, on shared pages.

**Design.** `measure: accuracy`. Preregistered before any engine ran (`PREREGISTRATION-open-engine-print-5660.md`). Cell membership was written to `results/open-engine-print-5660/cells.json` in commit e3fc7ae25. One page per book, reusing existing references. English 1600–1699: EEBO-TCP same-edition pages (#5488) plus #5216 pages. English 1700+: #5216 Wikisource/Gutenberg pages, mostly 1880–1930. Greek print: by-eye `typeset-print` pages with `greek_share` ≥ 0.5 from the `greek`, `greek-ext` and `greek-ext2` strata. Latin and German: EEBO-TCP Latin (15 library books) plus Wikisource scans (external; eval-design §3.5 says these never count toward a library grade). Of the 29 German pages scored, 21 are Fraktur, 7 Antiqua and 1 mixed, by eye (`german-typeface.json`). Agreement-only strata (library pages, no reference): `latin-pre1700`, `latin-1700s`, `german-fraktur`, `longs-en-fr`. Arms: production `gemini-3.1-flash-lite` (generic prompt, thinking 0, temperature 0; existing outputs reused, run fresh on EEBO-TCP and #5216), a lite repeat as the A-vs-A floor, and **PaddleOCR-VL-1.6** (paddleocr 3.7.0, paddlex 3.7.2, paddlepaddle-gpu 3.2.1 cu129, vLLM 0.10.2 genai server, CLIENTS=8, layout ON, weights sha256 `85a479d5…`). Paddle ran on one RunPod SECURE RTX PRO 4000 Blackwell, the GEX45's GPU, using the `paddle-zh-box.sh arm` recipe (branch `job-paddle-zh-5600d`, rev eec7802). All arms read the same 632 JPEGs. Scored by `benchmark-score.mjs`; decided by `benchmark-cost-lane.mjs --cells` (the #4925 rule, unchanged).

**Result.** No cell routes to the box.

| cell | n refs (library + external) | lite CER | Paddle CER | median Δ [95% CI] | Paddle W/L/T | catastrophic Paddle vs lite | verdict |
|---|---|---|---|---|---|---|---|
| Latin 1500–1699 | 36 (15 + 21) | 0.067 | 0.091 | +0.022 [+0.016, +0.036] | 2/33/1 | 1 vs 2 | directional (15 library), lean: keep lite |
| Latin 1700+ | 39 (0 + 39) | 0.007 | 0.039 | +0.010 [+0.006, +0.020] | 4/33/2 | 0 vs 2 | directional (external only), lean: keep lite |
| German (21 Fraktur by eye) | 29 (0 + 29) | 0.005 | 0.055 | +0.047 [+0.035, +0.063] | 1/28/0 | 1 vs 0 | directional (external only), lean: keep lite |
| English 1600–1699 | 59 (59 + 0) | 0.053 | 0.063 | +0.012 [+0.001, +0.023] | 20/38/1 (p = 0.025, lite better) | 1 vs 3 (3 lite refusals) | **keep lite** (rule: fails invention 0.214 vs 0.171, and has 1 loop) |
| English 1700+ | 106 (106 + 0) | 0.022 | 0.019 | 0.000 [0.000, 0.000] | 32/29/45 | 0 vs 21 (21 lite refusals) | **keep lite** by the rule. Its only failed check is invention, 0.020 vs 0.018: a near-tie |
| Greek print | 114 (114 + 0) | 0.145 | 0.510 | +0.327 [+0.269, +0.364] | 1/113/0 | **58** vs 1 | **keep lite** (fails every check) |

- **Noise floor:** lite vs its repeat, median Δ₀ = 0.000 in every cell (temperature 0; the check cannot fail by design, #4925).
- **Refusals:** lite's RECITATION refusals (this harness has no retry; production has one, #5521) count at CER 1.0, as in prior studies. On answered pages only, English 1700+ is lite 0.017 vs Paddle 0.020, Δ 0.000 (85 pages), and English 1600–1699 is Δ +0.014 (56 pages).
- **Greek per period:** 1450–1699 (56 books), lite 0.171 vs Paddle 0.607, Paddle catastrophic on 46 pages. 1700–1799 (53 books), 0.107 vs 0.314, 11 catastrophic. Paddle reads polytonic print as fluent *Modern* Greek-looking nonsense.
- **Agreement strata** (library pages, no reference; agreement with lite, flash-preview as the yardstick): `latin-pre1700` Paddle 0.946 vs flash 0.955; `latin-1700s` 0.967 vs 0.977; `german-fraktur` **0.905** vs 0.985; `longs-en-fr` 0.956 vs 0.962.
- **Lite's known weak spots (#4877), descriptive** (`weak-spots.json`): on EEBO-TCP (73 pages; the reference keeps ſ 634 times), lite writes ſ 491 times and Paddle never. Words with ſ misread as f: lite 1,030 (repeat 1,092), Paddle **1,261**. On `latin-pre1700`, abbreviation marks: lite 206, flash 300, Paddle 93; ſ: lite 86, flash 629, Paddle 0. Paddle repairs none of lite's long-s weakness. It drops ſ and abbreviation marks more than lite does.
- **Five pages read by eye (`read-from-image`, Claude reading the JPEG):**
  1. EEBO *Jew of Malta* (ed-6a08fd…-p27, Paddle CER 3.09). Paddle titles it "The Law of Malta", loops "ab sol:" for hundreds of tokens in place of six verse lines, and **invents a closing line, "Entrée le 10 dès le 11 juin 2023"**. Lite is faithful except that it writes ſ as f.
  2. *Ethics of Maimonides* bibliography with Hebrew titles (en-6aa1d5-ws52). Paddle writes the Hebrew as Greek, then Cyrillic, then a looping Tamil-script string, and drops entries 6–11. Lite reads the Hebrew.
  3. Plutarch *Platonicae quaestiones* (1552), ligature-dense Greek (greek-ext2-e0caa7-p61). Paddle produces word-shaped nonsense ("Ἀλλ᾿ πρῶδες ἀξιίνες…"), 1.7× the reference length. Lite tracks the text ("ἄλλο προστιθέντες. κὴ γὰρ εἰκὸς…").
  4. *De fide*, two-column gothic rotunda, about 1500 (latin-pre1700-0b0df1-p100). Paddle invents line numbers ("710", "312", "313"), puts Greek letters into the Latin ("οἰδιτ", "ἐλῆ δαῦρ") and reads "fermento" for "sermo". Lite reads it and keeps the marks (spūs, creat⁹).
  5. german-fraktur-d95833-p8 is **Kurrent handwriting** (a Masonic lodge ritual), not Fraktur print; this is a catalogue/stratum error. Paddle invents English prose and loops "I love you". Lite's German matches the first lines by eye.
- **Throughput and cost:** 632 pages, 0 errors, 608.8 s after model load, so **0.96 s/page** with layout on and 8 clients. That is ≈ 3× the 0.34 s/page measured on Chinese (#5660): Latin-script pages carry more text. On the GEX45 ($249/mo) that is **$0.091 per 1,000 pages**. Lite measured $0.90 per 1,000 realtime, ≈ $0.45 per 1,000 on Batch (generic prompt). 6.9M Latin pages would be ≈ 77 box-days.
- **Second open engine: not run.** olmOCR-2-7B-FP8 served within 3 min on the first pod and was reading at ≈ 1.6 s/page when the Hetzner RunPod watchdog terminated the pod as "idle". The watchdog reads progress only under `/root/paddle-zh-5600/runpod/<id>`, so ≈ 200 olmOCR outputs were lost; the Paddle outputs had already been pulled. A lean re-install (fresh venv: transformers 5.18 is incompatible with vLLM 0.10.2, and the engine core still failed after pinning 4.56.2) did not serve within the brief's 20 min. That pod was terminated and confirmed gone.

**Deviations, all reported.**
1. On the first warm-up, the vLLM engine wedged: 39 requests at 0 tokens/s. I restarted the server and raised the page timeout from 90 s to 300 s; the warm-up pages were discarded. A `paddle-zh-box.sh arm` that starts the server itself never returns from its `wait`, because the server is its background job; I killed that shell by hand.
2. Lite ran through `benchmark-run-api.mjs` (realtime), not Batch: same model and prompt as the reused arms, at $0.56 in total.
3. Paddle emits layout markup (HTML tables, `<sup>`, LaTeX, Greek written as `$\omega\tau\eta$`). Convention rule `open-engine-markup@1` strips it and maps LaTeX Greek to Unicode. It touched 130 of 632 Paddle pages, and only in Paddle's favour.
4. Cell counts differ from the prereg table's estimates: Latin 1500–1699 has 21 Wikisource pages, not 23 (two incunabula fall before 1500); English 1600–1699 has 59; English 1700+ has 106. Membership is the committed `cells.json`.
5. The scored files are in `results/open-engine-print-5660/scored/`, not `results/benchmark/`. A results file there without the Kraken/MinerU arms would become the dashboard's latest and drop them. The dashboard is not regenerated (landing rule 3 deferred).

**Implication.** PaddleOCR-VL-1.6 is a Chinese-manuscript engine. On Latin-script early print it is worse than lite on almost every page. On Fraktur it is clearly worse. On Greek print it is catastrophic. On modern English it ties lite and never refuses. Its failures are the dangerous kind: confident invention and wrong-script output (fabricated dates, Modern-Greek-shaped nonsense, Tamil loops), not visible garble. **The Latin backlog stays on lite.** The box's job list for #5660 is Chinese, Tibetan, Syriac, NDL and CLIP. A decision-grade Latin cell still needs ≥ 50 *library* Latin references (#5126); every Latin cell here is directional, and its lean is clearly lite. One possible use is English 1700+, as a refusal fallback (0 vs 21 refusals) behind production's recitation retry; that is a separate, unproposed question.

**Replicated?** No. Paddle ran once; lite ran twice (A-vs-A). **Artifact:** `results/open-engine-print-5660/` (`cells.json`, `scored/`, `cost-lane-paddle.json`, `summary.json`, `weak-spots.json`, `german-typeface.json`, `paddle-arm-run.json`, `paddle-box.json`). Raw outputs (incl. Paddle's pre-normaliser text) are on Hetzner at `/root/ocr-bench-5660` and `/root/paddle-latin-5660`. Cost: Gemini $0.56; GPU ≈ $0.76 (pod 1 59 min, pod 2 21 min, at $0.57/h).

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
