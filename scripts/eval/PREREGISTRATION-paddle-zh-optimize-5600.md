# Preregistration — #5600 step 3: the cheapest PaddleOCR-VL configuration that reads the Siku Quanshu cohort as well as the pilot recipe

PRIOR ART: `PREREGISTRATION-chinese-cohort-5547.md` (the sealed set, the references, the pilot recipe this
measures against); `PREREGISTRATION-chinese-skqs-5568.md` (same sample rule, seed per issue). Neither
varied the serving configuration — #5547 measured one recipe's accuracy and one recipe's throughput.

Committed before any arm below runs. Issue #5600. GPU budget for this benchmark ≤ €25 (inside the lane's
€1,000 cap). No Gemini call. Nothing is written to `pages`, `books` or `page_translations` by this
benchmark; the scorer and the outputs are files.

## Question

The pilot recipe (#5547 step 4: paddleocr 3.7.0 / paddlex 3.7.2 / paddlepaddle-gpu 3.2.1, `PaddleOCRVL()`
default pipeline, native Paddle inference, 2 runners on one Scaleway L4-1-24G at €0.7875/h) read
**3.35 s/page wall, €0.00089/page billed**. At that rate the deduplicated cohort (7,006 books, 1,054,374
pages) costs ≈ €940 — at the €1,000 cap. Which configuration reads a page for less without reading
it worse?

## Accuracy sample (fixed now)

From the sealed `benchmark/chinese-cohort-5547.json` (540 pages, one per book): pages whose book is in
the **held** cohort, eye-classified `manuscript-regular` (`benchmark/script-class/chinese-cohort-5547.jsonl`),
with a Kanripo/CBETA reference text (`benchmark/refs/chinese-cohort-5547.refs.jsonl`). Slug-sorted, drawn
without replacement with `makeRng(5600)` (`scripts/eval/lib/paired-stats.mjs`): **100 pages, one per book**.
`paddle-zh-5600-optimize.mjs sample` writes the list; the draw is made before any arm is scored.

Images: the sealed images exactly as the #5547 engines saw them (`/root/ocr-bench/images/chinese-cohort-5547/`,
≤ 2,400 px wide), except where an arm changes the size.

Scorer: `benchmark-score.mjs` (CJK normalisation, variant folding, the windowed reference CER), unchanged.
Per page and arm: CER against the reference; catastrophic = CER > 0.5 (the scorer's rule).

## Arms

| id | what changes | why |
|---|---|---|
| `base` | nothing: the #5547 PaddleOCR-VL outputs for these 100 pages | the baseline, already measured |
| `base-repeat` | the same recipe rerun on the #5600 box | **A-vs-A noise floor** (eval-design §7) and proof the box reproduces the stack |
| `a-vllm-cN` | the VL recognition model served by PaddleOCR's genai server (vLLM backend; SGLang if vLLM will not install), N concurrent pipeline clients, N ∈ {2, 4, 8, 16} | batching the 0.9B VLM is where the GPU idles today |
| `b-1600`, `b-1280` | long side capped at 1,600 / 1,280 px (Lanczos), on the winning backend | fewer vision tokens per block |
| `c-nolayout` | `use_layout_detection=False` (the whole page to the VLM) on the winning backend | a single-grid manuscript page may not need the layout stage; reading order is the whole point, so it must pass the same gate |
| `d-prefetch` / runners | images fetched and resized by a CPU thread pool ahead of the GPU; runners per GPU 1/2/3 (native) or clients (server) | the GPU must never wait on R2 |
| `e-l40s`, `e-h100` | the winning configuration on a Scaleway L40S-1-48G / H100-1-80G, if Scaleway has stock | €/page, not €/hour |

An arm that will not install or will not run is reported as such with the error, not dropped.
RunPod / Vast: a €/page **estimate** from their list prices and the measured s/page on the closest GPU;
not run (the lease watchdog manages Scaleway only).

## Throughput set (fixed now)

Accuracy pages are too few to time a concurrent server. Throughput is measured on a fixed set: the first
**400 book pages** of the #5547 pilot manifest after its benchmark block (`/root/zh-ocr-eval-5547/pilot/manifest.tsv`,
held-cohort SKQS volumes), wall seconds from the first page started to the last page written, models loaded
before the clock starts. s/page = wall / pages written. €/page (compute) = s/page × €/h ÷ 3600. The
projection to the cohort adds the measured per-box overhead (boot, install, pull) per box-run.

## Gate and choice (fixed now)

For each arm, on the 100 accuracy pages:
1. **Δ** = median over the pages of (CER_arm − CER_base). Gate: **Δ ≤ +0.01**.
2. **Catastrophic rate** = pages with CER > 0.5 (or no output) ÷ pages with a usable reference. Gate:
   **≤ 2 %, or no more catastrophic pages than `base`, whichever is larger** (amended, see below).
3. Reported beside both: the `base-repeat` floor (its Δ and catastrophic rate), loops by the production loop
   guard, empty reads, paired wins/losses/ties vs `base`.

If `base-repeat` itself fails the gate (the recipe is noisier than the margin), the result is labelled
**noise exceeds margin** and no arm is chosen on accuracy grounds; the lane then runs the pilot recipe.

**Choice:** among the arms that pass both gates, the lowest €/page. Arms combine (e.g. server + 1,280 px);
a combination is chosen only if the combination itself has been run on the 100 pages and passes.
Ties within 5 % of €/page go to the arm closer to the pilot recipe.

The five worst pages of the chosen arm are read by eye against the image (`read-from-image`) before the
fleet uses it.

## Reported

A table on #5600 — arm, s/page, €/page, median CER, Δ vs base, catastrophic, verdict — and
`scripts/eval/experiments/2026-10-02-paddle-zh-optimize-5600.md`.

## Amendments (before any arm ran)

**2026-10-02, before the box read a single arm page.** Scoring `base` alone showed two instrument facts the
draw did not anticipate:
1. `benchmark-score.mjs` drops a page's reference when no engine in the run gets within CER 0.5 of it (the
   reference-mismatch guard), so the usable-reference set depends on which engines are present. The two
   #5547 Gemini arms (`gemini-3.1-flash-lite`, `gemini-3-flash-preview`) are therefore always included as
   **anchors** (scored, never reported or gated) so the usable set is #5547's. Of the 100 pages, 95 have a
   usable reference; 5 are reference-mismatch pages and are listed, not averaged.
2. `base` is catastrophic on **2 of 95 (2.1 %)** — just over the absolute 2 % gate, so as written the gate
   would reject the pilot recipe itself. The catastrophic gate becomes **≤ max(2 % of scored pages,
   base's count)**: an arm may not be catastrophic on more pages than the recipe it replaces. The Δ gate is
   unchanged.

**2026-10-02 09:55Z, before any RunPod arm was scored (brief amended: "compare gpu costs").** RunPod arms are
now RUN, not estimated — the paragraph above saying "not run (the lease watchdog manages Scaleway only)" is
superseded: `scripts/maintenance/runpod-pod-watchdog.mjs` (Hetzner cron, every 10 min) terminates any
`sl-5600-*` pod past the deadline in its name or with no new output for 30 min; negative control passed
(a CPU pod with a 5-min deadline was terminated by the 09:50 pass, confirmed gone). GPU arms: RTX 3090,
RTX 4090, RTX 5090, L4, L40S (community cloud first, secure if community has none; availability recorded
per type). Same images, same 100 accuracy pages, same 400-page throughput set, same scorer and gate.
€/page on RunPod = s/page × $/h ÷ 3600 × 0.86 €/$ (2026-10-02), per-second billing; startup minutes
(create → ssh → setup) are reported per pod and added in the cohort projection. The backend sweep
(native vs the genai vLLM server at 4/8/16 clients) runs on the cheapest GPU RunPod had in stock (3090)
rather than the Scaleway L4, because the L4 was busy with the pilot; `base-repeat` (the recipe on the
Scaleway L4) remains the A-vs-A floor. Choice rule unchanged, plus: a winner must have had stock at the
time it was measured and a fallback provider for the run length.

## Amendment — `c-nolayout` confirmation on fresh pages (2026-10-02 ~21:40Z, before any fresh page is read)

On the 100 accuracy pages the no-layout arm (`o4000b-c8-nolayout`: vLLM c8, `use_layout_detection=False`,
RTX PRO 4000 Blackwell) passed the gate and scored *better* than base (median CER 0.175 vs 0.205,
catastrophic 0/95, W/L/T 69/11/15). Those 95 pages chose the arm, and the Kanripo references omit the
margin text (版心, the fold strip 欽定四庫全書, juan title, leaf number), so an arm that simply drops the
margins scores a lower CER without reading the body any better. Before the fleet adopts it:

**Fresh sample.** From the same pool as the original draw (sealed `chinese-cohort-5547`, cohort `held`,
eye `manuscript-regular`, non-empty reference), minus the 100 pages already drawn, minus every book in the
#5547 pilot (`/root/paddle-zh-5600/pilot-books.txt`) and every book the #5600 fleet has applied
(`applied-books.jsonl`) — if that leaves fewer than 100, the fleet exclusion is dropped and the overlap is
reported. Slug-sorted, `makeRng(56001)`, without replacement, **100 pages** (or the whole remainder if fewer).
`paddle-zh-5600-optimize.mjs sample --fresh` writes `results/paddle-zh-5600/sample-fresh.json`.

**Arms on the fresh pages,** same pod, same images (≤ 2,400 px wide), vLLM server c8: `layout-on` (the fleet
recipe) and `nolayout` (`LAYOUT=0`). `base` (#5547 Paddle outputs) and the two Gemini anchors are scored
alongside, as before.

**Body recall** (new, reported for every arm on both page sets): per page, the share of reference
characters the reading contains, order-free — Σ_c min(n_hyp(c), n_ref(c)) / |ref|, after the scorer's own
CJK normalisation (variant folding, Han/kana only, 6,000-char cap). Insensitive to extra margin text by
construction; it falls only when body text is missing or misread.

**Adoption rule for `LAYOUT=0` in the fleet** — all four, on the FRESH pages, against `layout-on`:
1. median per-page Δ CER (nolayout − layout-on) **≤ 0**;
2. catastrophic pages (CER > 0.5 or no output) **≤ layout-on's**;
3. median body recall **≥ layout-on's − 0.01**;
4. by eye (`read-from-image`, 5 pages of the original 95: 2 of the largest no-layout wins, 1 loss,
   2 random): **no body text dropped** — margin text (header strip, juan title, leaf number) dropped is
   recorded as a reader-facing loss, not as a body loss.

If any fails, the fleet keeps the layout stage. Whatever the verdict, already-written pages are not re-read;
an adopted change applies to chunks not yet queued, and each page records `ocr.engine.serving.layout`.
Budget for this step: ≤ $5 RunPod.
