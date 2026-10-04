# Preregistration — an open engine on our own GPU for Latin-script and Greek PRINT (#5660 step 2)

PRIOR ART: `PREREGISTRATION-chinese-ext-4925.md` (the cost-lane non-inferiority rule this reuses
verbatim, as `benchmark-cost-lane.mjs` implements it), `PREREGISTRATION-greek-ext-4925.md` (Greek print
cell membership: by-eye `typeset-print`, `greek_share ≥ 0.5`), `PREREGISTRATION-english-modern-5182.md`
(the 122 English references), the EEBO-TCP stratum of #5488. None of them runs an open engine on
Latin-script print: PaddleOCR-VL was measured only on Chinese/Japanese (#4925, #5547, #5600), and the
2026-09-15 specialist tie on Latin print was Kraken/Surya.

Written 2026-10-03, before any engine ran on these pages for this study. Nothing below changes after
the run; deviations are reported as deviations.

## Question

Does PaddleOCR-VL-1.6 on our own GPU read Latin-script and Greek print well enough to replace
production `gemini-3.1-flash-lite` for the ≈ 8.3M-page print OCR backlog (Latin 6.9M, German 0.64M,
English 0.51M, Greek 0.34M; #5660)? Answered per cell, against references, on shared pages.

## Cells (fixed here; membership written to `results/open-engine-print-5660/cells.json` before the run)

Every page is one book (one page per book). "Library" = one of our books; "external" = a Wikisource
scan with `book_id: null` (eval-design §3.5: external pages never count toward a library grade).

| cell | pages (source) | library books | grade it can reach |
|---|---|---|---|
| `latin-1500-1699` | EEBO-TCP Latin 1600s (15, #5488) + Wikisource-la scans 1500–1699 (23) | 15 | directional (external-majority) |
| `latin-1700+` | Wikisource-la scans 1700+ (42) | 0 | directional (external) |
| `german` | Wikisource-de scans (30; 1 before 1700) | 0 | directional (external); Fraktur/Antiqua by eye, reported |
| `english-1600-1699` | EEBO-TCP English 1600s (53) + #5216 refs with catalogue year 1600–1699 (8) | 61 | decision-grade |
| `english-1700+` | #5216 refs with catalogue year ≥ 1700 (≈ 113: 9 × 1700s, 29 × 1800–1879, 75 × 1880–1930) | ≈ 113 | decision-grade (labelled: mostly 19th–20th c.) |
| `greek-print` | `greek`, `greek-ext`, `greek-ext2` pages with a reference, by-eye `typeset-print`, `greek_share ≥ 0.5` | ≈ 120 | decision-grade; per-period split (1450–1699 / 1700–1799) reported |

Excluded, and why: #5216 refs marked `reference_error` or with `leaf_check.status != ok` (8); the
EEBO English 1500s (5, reported apart); `ref-pinned` (no year; half canonical: Vulgate, Aeneid).
**Agreement-only strata** (no references; `measure: agreement`, never quality): `latin-pre1700` (23),
`latin-1700s` (24), `german-fraktur` (24), `longs-en-fr` (28) — library pages where the backlog lives;
Paddle vs lite and vs flash-preview agreement, and the source of the by-eye reads.

## Arms

| arm | settings | pages |
|---|---|---|
| `gemini-3.1-flash-lite` (production model) | `benchmark-run-api.mjs`, generic transcription prompt, thinking 0, temperature 0 — existing outputs reused where the page set matches (Greek, Wikisource, agreement strata); run fresh on EEBO-TCP and #5216 pages | all |
| `gemini-3.1-flash-lite-b` (A-vs-A noise floor) | same, second run | existing on Greek; run on EEBO-TCP, #5216, Wikisource |
| `paddleocr-vl-1.6` | `paddleocr[doc-parser]==3.7.0`, `paddlex==3.7.2`, `paddlepaddle-gpu==3.2.1` (cu129), genai server (vLLM) with CLIENTS=8, **layout ON**, max width 2400, recipe `scripts/gpu/paddle-zh-box.sh arm` (branch `job-paddle-zh-5600d`, rev eec7802) | all |
| optional second open engine | only if it installs in < 20 min on the same pod; else "not run" | all, if run |

Hardware: one RunPod SECURE RTX PRO 4000 Blackwell (the GEX45's GPU), else L4 SECURE. Same JPEGs for every arm.
Spend cap: GPU ≤ $5, Gemini ≤ $2.

## Metrics (`benchmark-score.mjs`, unchanged kernel)

`measure: accuracy` per page: CER against the reference window (windowed lower bound for the Wikisource
tier), catastrophic = CER > 0.5, invention (`invention_ref`), loops, refusals (finishReason). Paired per
page against lite on pages both answered. Before scoring, Paddle's output is diffed by eye against the
image on two known-good pages (eval-design §6, conventions) and any systematic non-error (markdown
headings, table HTML) is reported with the normaliser rule applied to it.

## Decision rule per cell (`benchmark-cost-lane.mjs`, the #4925 rule as written)

Δ = CER(Paddle) − CER(lite) per page; Δ₀ = CER(lite-b) − CER(lite).

- **route to box** (cost lane adopted) iff, with ≥ 50 paired **library** books: median Δ ≤ +0.02 ∧
  bootstrap-95% CI upper of median Δ ≤ +0.05 ∧ |median Δ₀| < 0.02 ∧ catastrophic(Paddle) ≤
  catastrophic(lite) + 1 ∧ median invention(Paddle) ≤ lite ∧ loops(Paddle) ≤ lite.
- **keep lite** if the cell is decision-grade and any check fails.
- **directional** if the cell has < 50 paired library books: the interval and the lean are reported,
  no routing decision. A directional cell is a draw-more/reference-more item, never a proxy top-up.

Reported alongside, not decisive: lite's refusals (pages lite refused are a cost of lite — counted
as catastrophic for lite in a second view), s/page (arm wall after model load ÷ pages, CLIENTS=8),
$/page on the GEX45 ($249/mo ÷ 2.63M s × s/page) vs lite's metered $/page (realtime; batch = ½).

**Known lite weak spots (#4877), descriptive only:** on the early-print pages (EEBO-TCP, Latin
1500–1699, the agreement strata) per engine: long-s rendered as `ſ` / as `s` / misread as `f`
(output token that becomes a reference token under f→s), abbreviation marks (macron vowels, `ꝑ ꝓ ꝗ`,
`q;`, `&c`), ligatures (`æ œ ß` and `ct`/`st`). Plus five pages read by eye (`read-from-image`): the
worst Paddle page per decision cell and the largest Paddle-vs-lite disagreements on the agreement strata.

## Outputs

`results/open-engine-print-5660/` (cells, cost-lane JSON, throughput, weak-spot tally),
`results/benchmark/<stratum>-<date>.json` (scorer), `experiments/2026-10-0X-open-engine-print-5660.md`,
one comment on #5660.

## Amendment 1 — the olmOCR-2 arm (job olmocr-5660b, written 2026-10-03 before any olmOCR output was scored)

The "optional second open engine" row, now run on its own pod because the first attempt's outputs were
lost to the RunPod watchdog (see the experiment file). Nothing above changes: same 632 JPEGs
(`<lane>/bench/acc.tsv`), same `cells.json`, same scorer, same convention rule, same decision rule.

| | |
|---|---|
| engine label | `olmocr-2-7b-fp8` |
| weights | `allenai/olmOCR-2-7B-1025-FP8` (Hugging Face; snapshot hash recorded in the run's `olmocr-arm-run.json`) |
| server | vLLM in the venv recipe that served it on 2026-10-03 (`paddleocr install_genai_server_deps vllm` → vLLM 0.10.2, flash-attn 2.8.3 wheel); `--max-model-len 12000 --gpu-memory-utilization 0.90 --limit-mm-per-prompt '{"image":1}'`; exact pip versions recorded |
| client | `olm-run.py` (in the lane's `code/`), 8 threads, temperature 0, `max_tokens` 4500, one attempt per page (no retry ladder, no anchor text), page scaled to longest side 1288 px, sent as PNG; the YAML front matter is stripped before scoring |
| hardware | one RunPod SECURE RTX PRO 4000 Blackwell (else L4 SECURE) |
| warm-up | the 16-page `tput.tsv` set first, discarded |
| s/page | arm wall ÷ 632 pages (the server is up before the clock starts) |

Prompt, verbatim (olmOCR-2's own `build_no_anchoring_v4_yaml_prompt`, the prompt it was trained on):

> Attached is one page of a document that you must process. Just return the plain text representation of this document as if you were reading it naturally. Convert equations to LateX and tables to HTML.
> If there are any figures or charts, label them with the following markdown syntax ![Alt text describing the contents of the figure](page_startx_starty_width_height.png)
> Return your output as markdown, with a front matter section on top specifying values for the primary_language, is_rotation_valid, rotation_correction, is_table, and is_diagram parameters.

Scoring: `open-engine-print-5660.mjs paddle-in --engine=olmocr-2-7b-fp8` (the same `open-engine-markup@1`
rule, UNCHANGED — it does not touch olmOCR's figure placeholders `![alt](page_….png)`, so their alt text
counts against olmOCR; the number of pages carrying one is reported, and a placeholder-stripped view is
descriptive only) into a SEPARATE bench root that holds the lite, lite-b and flash-preview outputs but not
Paddle's, so that `invention` ("in neither the reference nor any other engine") is measured against the
same other-engine set as Paddle's was. Scored files go to `results/open-engine-print-5660/scored-olmocr/`;
the cost-lane file is `cost-lane-olmocr.json`. Five pages by eye (`read-from-image`), including one
long-s page and one Greek page: the worst olmOCR page per decision cell plus the largest olmOCR-vs-lite
disagreement on the agreement strata.

## Amendment 2 — round 3: six more arms, and 25 more Latin library references (job ocr-bakeoff-5660c, written 2026-10-04 before any round-3 output was scored)

Nothing above changes: same cells, same scorer (`benchmark-score.mjs`), same `open-engine-markup@1` convention rule
(unchanged — it does not touch a VLM's figure/`<img>` descriptions, so their text counts against the engine; the
number of pages carrying one is reported), same `benchmark-cost-lane.mjs --cells` rule, same 632 JPEGs. Each arm is
scored in its OWN bench root holding lite, lite-b and (where rounds 1-2 had it) flash-preview, never another open
engine's output, so `invention` is measured against the same other-engine set Paddle and olmOCR faced.

**References added before any round-3 run (the brief: Latin pre-1600 under 30 references).** EEBO-TCP (CC0) same-edition
transcriptions for Latin library books on our EEBO-microfilm (`bim_`) scans, matched by title + year to `TCP.csv`
(not by STC: our records carry none), cut by `build-edition-refs.mjs` (`--draw=8 --seed=1`, the middle accepted page),
leaf-checked by Claude reading each page image (`results/edition-refs/leaf-check-eebo-tcp-latin-2026-10-04.json`;
rule: ok = window's first/last lines match the page body within about one line; a page must be Latin-majority by
eye, one alternate tried). 31 checked, **25 written** (1500–1599: 4; 1600–1699: 21), new stratum `eebo-tcp-latin-5660`,
lite / lite-b / flash-preview run on it through `benchmark-run-api.mjs` (generic prompt, as before). Cell map:
`results/open-engine-print-5660/cells-r3.json` = `cells.json` + these 25 in `latin-1500-1699` (origin library).
`latin-1500-1699` becomes 61 pages, 40 library — still under 50, so **directional**. Its 1500–1599 part is 14 pages
(10 Wikisource + 4 library): **no winner is called on it** (the brief's 30-page floor); it is reported descriptively.
Every arm (old and new) is reported on the original 632-page cells AND on the 657-page `cells-r3` map; the round-1/2
arms (Paddle, olmOCR) were not run on the 25 new pages and are compared only on the 632.

**Arms** (all on one RunPod SECURE RTX PRO 4000 Blackwell, vLLM 0.30.0 / torch 2.13 / transformers 5.18 in one uv venv,
`--max-model-len 32768 --gpu-memory-utilization 0.85 --limit-mm-per-prompt '{"image":1}'`; temperature 0, one attempt,
8 client threads, the page JPEG sent as is; warm-up on the 16-page `tput.tsv`, discarded; s/page = arm wall ÷ 657
with the server up; install-and-serve budget 30 min per arm, else "not run"; HF snapshot hashes recorded):

| label | weights | prompt / call (each model's own documented one) | max tokens |
|---|---|---|---|
| `glm-ocr` | `zai-org/GLM-OCR` (0.9B), MTP speculative decoding as the vLLM recipe serves it (else plain) | image + `Text Recognition:` (vLLM recipe) | 4500 |
| `dots-ocr` | `dots-studio/dots.ocr` (was `rednote-hilab/dots.ocr`), `--trust-remote-code` | image + `<\|img\|><\|imgpad\|><\|endofimg\|>` + `prompt_layout_all_en` (repo `dots_ocr/utils/prompts.py`); page text = the layout JSON's `text` fields in the model's order, `Picture` skipped; truncated JSON recovered by regex (counted) | 8000 (JSON + bbox overhead) |
| `nanonets-ocr2` | `nanonets/Nanonets-OCR2-3B` | system "You are a helpful assistant." + image + the model card's OCR prompt | 4500 |
| `mineru25-pro` | `opendatalab/MinerU2.5-Pro-2605-1.2B` — a 1.2B VLM, a different model from the MinerU 3.4 CPU *pipeline* (`-m ocr`) run in #5182 | `mineru-vl-utils` 2.0 `MinerUClient(backend="http-client").two_step_extract` (layout, then content), server with `MinerULogitsProcessor` (else without); page text = every block's content in returned order | client-managed |
| `kraken-catmus` | Kraken 7.1, default `blla` segmentation + `catmus-print-fondue-large` (CATMuS-Print), CPU on the pod | `kraken -a … segment -bl ocr -m catmus` ; text = ALTO TextLine order | — |
| `calamari-gt4histocr` | Calamari 2.3.1 + `gt4histocr` (calamari_models 2.2, 5-checkpoint voting ensemble, trained on GT4HistOCR 1500–1900 print), CPU on the pod | the SAME Kraken line polygons, cropped grey, outside-polygon white, 2 px pad; text = lines in Kraken's order | — |

The two CPU arms run on the non-Greek pages only (397 of 657: every non-Greek cell page plus the four agreement strata);
neither has a Greek model in this setup, and Greek is already decided for lite. Client-side handling beyond the above:
a ```` ``` ```` code-fence line is dropped (glm, nanonets); nothing else. A failed request is an empty output.

**Reported per arm, per cell:** the prereg table (lite CER, arm CER, median Δ [95% CI], W/L/T, catastrophic, invention,
loops, verdict), the answered-only view, s/page and $/1,000 pages on the GEX45, the long-s tally (`tally`, ſ→f misreads
on EEBO-TCP — now also on the 25 new pages), and by-eye reads (`read-from-image`) of the worst page per arm on the two
priority cells (English 1600–1699, Latin 1500–1699). The headline compares each arm with **lite** under the rule and, for
English 1600–1699, also names olmOCR's numbers beside it (no new rule: olmOCR is the cell's current passing arm).
