# Pre-registration — Bench 2: can self-hosted OCR replace Gemini on early modern print?

PRIOR ART: `PREREGISTRATION-prompt-ablation.md` (format), `~/sourcelibrary-ops/handoffs/2026-09-01-ocr-instrument-eval-plan.md` (Bench 2 spec), `~/sourcelibrary-ops/eval-tibetan/RESULTS-2026-09-01-phase0.md` (Bench 1, decided). None covers the print bench itself.

_Written 2026-09-03, **before the GPU run**. Issue #4523 (claimed in-thread). Derek
picked Scaleway; the archived L4 `sl-ocr-gpu-test` (fr-par-1) is reused — CUDA 13
setup traps already solved there. Decision rules are fixed here so they cannot be
picked after seeing the numbers._

## Question

Gemini flash-lite OCRs the corpus at ~$0.79/1k pages. Specialist engines cost
$0.02–0.18/1k (or CPU-only ≈ free). For the three big **print** backlogs — Latin
(7.9M pages awaiting), Greek polytonic (1.7M), German Fraktur (0.8M) — does any
self-hosted engine match or beat Gemini **on pages it cannot recite**, and what is
the measured cost per 1k pages at that quality?

Secondary (Derek, 2026-09-03): the **cheap-first architecture** — specialist first
pass, Gemini escalation — additionally needs the *escalation rate*: what fraction of
pages does the specialist handle at acceptable quality without any Gemini call?

## Why the existing scorecards cannot answer this

Every good in-house Gemini number (Aeneid 98.5%, Iliad 99.3%) is on canonical text.
Bench 1 E4 demonstrated the confound with ground truth: Gemini agreed 0.79 with the
published canon while agreeing 0.33 with independent reads of the actual folio — it
recited. CRNN engines cannot recite, so canonical pages structurally flatter Gemini.
The decisive tier is **diplomatic**: edition-faithful transcriptions of the exact
pages (DTA-style, `non_canonical: true`, `memorization_risk: low`).

## Arms

| arm | runs | where |
|---|---|---|
| gemini-3.1-flash-lite (production prompt) | k=3 | API (temp 0; k>1 because 2026-09-02 showed k=1 is one draw) |
| Kraken + CATMuS-Print (+ Ciaconna for Greek) | k=1 + determinism check (k=2 on 3 pages) | L4 / CPU |
| Surya 2 | same | L4 |
| CHURRO-3B | same | L4 (weights Qwen research license — eval OK, flag before production) |
| hybrid: best-specialist draft + image → flash-lite correction pass | k=3 | published best on Fraktur (0.84% CER, arXiv:2504.00414) |

Pages: all pinned ground-truth Latin/Greek/German print pages, **canonical and
diplomatic tiers reported separately**; diplomatic tier is the deciding one.
Images via `bench2-export.mjs` (the exact `getPageSource` images production OCR'd);
outputs scored by `score-transcripts.mjs --engine=…` (same two-stage scoring and
raw-outputs JSONL as every Gemini arm; stats via `stats-cross-model.mjs`).

## Controls

- Positive control: reference scored against itself + 5% synthetic noise (aligner ceiling).
- Chance floor: each engine's output scored against a wrong page's reference.
- One page per book. Segment canonical vs diplomatic in every table — never pooled.
- Gemini recitation guard: canonical-tier-only wins for Gemini are flagged, not counted.

## Decision rules (fixed now)

1. **Reroute a language segment to a specialist** iff, on the diplomatic tier, its
   char-weighted accuracy ≥ Gemini's on the same pages (paired, per
   `stats-cross-model.mjs`), AND eyeballing its 5 worst pages shows loud failures
   (garbage/empty), not fluent fabrication.
2. **Adopt the hybrid for a segment** iff it beats both its specialist draft and
   direct Gemini on the diplomatic tier.
3. **Cheap-first escalation viable** for a segment iff ≥70% of pages clear a
   quality gate (accuracy within 2pp of Gemini's median on that segment) from the
   specialist alone — then projected cost = specialist cost + (escalated% × Gemini rate).
4. **GPU vs CPU**: record measured s/page and €/1k pages per engine on the L4 and on
   CPU where the engine supports it (Bench 1 showed the BDRC "GPU job" was CPU-bound;
   do not assume).
5. Fewer than 4 diplomatic pages in a language ⇒ that language is **UNDECIDED** —
   report it as such, never decided on canonical pages alone.

Budget: ≤ €25 GPU + ≤ $5 Gemini arms. Log the conclusion in `EXPERIMENTS.md` with
the replication column filled.
