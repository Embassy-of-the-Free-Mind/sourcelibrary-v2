# Experiment log — what we ran, and what it concluded

PRIOR ART: `recommend-experiments.mjs` ranks experiments still *worth running*;
`INDEX.md` lists the scripts that exist. Neither records **what a run concluded**,
which is the thing that evaporates. This is that record.

Append-only, newest first. One entry per *question*, not per invocation. A null
result and a retraction are both first-class entries — the retractions are the
most valuable rows here, because a wrong number that stays uncorrected in a PR
description is how a mistake becomes doctrine.

**Rare-event discipline.** These runs happen a few times a month at most, so
nobody remembers them and nobody will re-read the code. Two lines here when you
finish is the whole mechanism. If you ran something and did not log it, the next
person pays for it again.

**Format.** Date · question · design · result · *replicated?* · artifact.
The replication column exists because of 2026-09-02, below.

---

## 2026-09-11 — Google Cloud Vision as a cheaper OCR lane?

**Headline: no lane. Parity on the pages it reads, but it reads fewer of them —
and on Tibetan it is the worst engine we have tested on our own scans.**

- **Question.** Cloud Vision DOCUMENT_TEXT_DETECTION is $1.50/1K pages against
  $3.42/1K measured on flash realtime and $0.85/1K on lite batch; BDRC's Tibetan
  leaderboard ranks it 3rd of 46. Is it a viable cheaper lane for any of our
  languages, and is its failure mode "garble, not invent"?
- **Design.** All 55 pinned ground-truth pages (the July v0.3 set plus the
  September Latin/Greek/German additions), per-page language hints, same
  `scoreAgainstReference` + normalisation as the July post, paired per page
  against the stored `gemini-3-flash-preview` and `gemini-3.1-flash-lite` runs
  (page = mean over aligned runs, exact sign test). Positive control: the
  Copernicus reference passage rendered as a clean modern page → **CER 0.00 %**.
  Plus 20 pages of the #4523 pilot book (`69e7abd05f1a22ab19a9e929`) scored on
  Derge identity with `kanjur_align.py` on clawdbot against the three Tibetan arms
  already on disk. 78 Vision units, $0 (free tier).
- **Result.**
  - Coverage: Vision aligns **37/55**; lite aligns 52/55 on the same pages. Where
    both align, Vision loses: vs lite 3W/19T/15L, sign p=0.0075, mean −1.09 pp;
    vs flash-preview 1W/13T/11L, p=0.0063, mean −0.51 pp. Per language, on
    aligned pages Vision is at parity on Greek print (median CER 0.21 % vs 0.19 %)
    and near it on German (0.71 % vs 0 %), behind on Latin (3.7 % vs 1.1 %),
    Armenian (4.9 % vs 3.1 %) and Chinese (8.2 % vs 1.7 %).
  - Coverage is the finding: 7/12 Latin pages fail the word guard (early-modern
    long-s, ligatures, abbreviations), 3/6 Chinese (interlinear commentary read in
    the wrong order), both Greek manuscripts (Greek minuscule read as Latin letters
    — the output on the Iliad pages begins `Inches cm 1 2`, the ruler in the
    photograph).
  - Failure mode, read by eye on the five worst pages: **garble, wrong reading
    order and non-text (rulers) — zero invention.** Every disputed string was on
    the page. Gemini's worst pages are a different kind: RECITATION refusals
    (8/8 runs on Hero 178 for flash-preview), a MAX_TOKENS loop of quote marks
    (Zohrab John 1), truncation. The novel-word proxy (output words absent from
    the reference passage) does not separate the two — it runs 0.30–0.81 for
    both engines because the reference is a passage, not the page — so the
    "garbles rather than invents" claim rests on the human read, n=5, and is
    consistent with but not proven by this run.
  - Tibetan: Vision median Derge identity **0.339** vs Gemini woodblock-prompt
    0.453, dbu-can-prompt 0.426, BDRC Yigdzin 0.51 (control 0.968, chance 0.083).
    Vision loses **20/20** to the woodblock arm and to Yigdzin. The leaderboard
    rank does not transfer to this manuscript Kanjur.
  - What Vision has that no VLM does: a per-block confidence. Mean block
    confidence tracks the guard loosely (0.98 on the control, 0.6–0.7 on the
    worst pages) — worth a look as a *triage* signal, not as a lane.
- **Decision.** No routing change. Vision is not a lane for any language here.
  Its one plausible use is as a non-generative *second reader* for triage
  (confidence + disagreement with Gemini flags a page), which is a different
  experiment. The per-language lite-suitability question this was a proxy for is
  now pre-registered in `PREREGISTRATION-per-language-ocr-suitability.md`.
- **Side finding.** `latin-la-praetorius-syntagma1-p120` is unpinnable: the
  stored pipeline OCR (printed p.72) aligns with the reference, but the archived
  image at `page_number 131` is printed p.73 and every engine run over it since
  (lite, Vision, Kraken, Surya, CHURRO) reads p.73 — a one-leaf image/text shift
  on book `69ef2b4685daccce30f2e066`. Filed as an issue; the page must be excluded
  from cross-engine rollups until repaired.
- *Replicated?* Single run (Vision is deterministic; the control re-scored
  identically on a second call). *Artifact:* `results/vision-vs-gemini-2026-09-11.{json,md}`,
  raw outputs in `results/scorecard-outputs-2026-09-11.jsonl` (model `google-vision`),
  transcripts in `results/vision-transcripts-2026-09-11/`, runner
  `google-vision-baseline.mjs`, `runGoogleVision()` in `lib/runners.mjs`.

---

## 2026-09-11 — Music: can a VLM read Shaker letteral notation? (first scored run)

**Headline: pitch yes, rhythm no.** gemini-3-flash-preview on seven verified
letteral references (180 notes, `scripts/music/ground-truth/`): interval NER
**0.19 mean, 0–0.08 on the five pages it read the right span of**; rhythm NER
**0.49** (long group underlines → quarters; half-note bars dropped). The July #3161
pilot's "85–90% rhythm" was eyeballed and is withdrawn. Cost $0.019. Positive
control on the scorer passed (0 on self, 0.06 on a one-edit copy). *Replicated?*
No (single run, temp 0). Artifact:
`scripts/music/eval-results/2026-09-11-letteral-gemini-3-flash-preview/README.md`.
Next: crop per music line and re-score the same seven.

**Same day, staff notation:** first mensural reference (Morley 1597 p.8 plainsong
ex. 1, twelve semibreves, checked against the printed solmization). Same model:
**pitch NER 0.42** — the candidate is the printed syllables mapped through the
natural hexachord, i.e. the model read the answer key, not the staff. The doc's
"VLMs cannot read staff notation" claim is now measured on our own page. Artifact:
`scripts/music/eval-results/2026-09-11-mensural-gemini-3-flash-preview/README.md`.

---

## 2026-09-03 — Bench 2 (complete): can self-hosted OCR replace Gemini on print?

**Headline: yes on quality, no decision yet on scope — n is too small.** Three
self-hosted engines are statistically indistinguishable from production Gemini on
pages they can read; the binding constraint is COVERAGE, not accuracy, and the
per-segment samples (5 Latin / 4 Greek / 2 German diplomatic pages) are a pilot,
not a mandate. Do not reroute a 7.9M-page backlog on this alone — scale the
diplomatic set to ≥20 pages per segment first (that is the next experiment).

- **Design.** Pre-registered (`PREREGISTRATION-bench2-print.md`, #4523). 11 new
  diplomatic (non-recitable, same-edition) pages pinned + 25 existing canonical;
  five arms on identical images (`bench2-export.mjs`), identical scoring
  (`score-transcripts.mjs --engine`): gemini-3.1-flash-lite k=3, Kraken 5.x CPU
  (CATMuS-Print; austriannewspapers for Fraktur; greek-cllg), Surya 2 (vLLM, L4),
  CHURRO-3B (L4). Cost: **€3.65 GPU + $0.05 API.**
- **Paired result** (`stats-cross-model.mjs`, pages both arms align, vs flash-lite):

  | arm | Δ vs Gemini | 95% CI | cost/page | speed |
  |---|---|---|---|---|
  | kraken-catmus-cpu | **+0.18pp** | [−0.28, +0.68] | **€0** (Hetzner CPU) | 20–50s |
  | surya2-l4 | **−0.04pp** | [−0.63, +0.46] | €0.00094 | 4.3s (98% GPU) |
  | churro3b-l4 | −0.69pp | [−1.66, +0.06] | €0.01435 | 65.4s |

  None is significantly different from Gemini. All three beat every commercial
  non-Gemini arm previously run on this set (Sonnet 5 −0.63, Mistral-OCR −0.97,
  Qwen-VL-Max −1.42, DeepSeek-OCR −2.10, Gemma −4.2/−7.5).
- **Coverage is the real finding.** Gemini aligns 52/56 pages; Kraken 25/56,
  Surya 28/56, CHURRO 28/56 (partly scope — specialists only ran the 36 print
  pages). The stats therefore read *quality given coverage*: equal accuracy **on
  pages the specialist can read**, which is exactly the cheap-first premise.
- **Per-script (diplomatic tier, tiny n — see headline):** Latin, all three
  engines within ±0.5pp of Gemini and 100% clear a 2pp accuracy gate. Greek,
  Kraken **+0.74pp over Gemini** and 100% guard-clean, while Surya/CHURRO lose
  ~2pp — a CRNN reads polytonic better than either VLM. German Fraktur inverts:
  CATMuS is not a Fraktur model (−4.3pp), a Fraktur-specific Kraken model reaches
  95–99% on 1618/1645 but decays with era distance, and **Surya/CHURRO solve
  early Fraktur outright** (98.5–99.8% on 1618/1645/1772).
- **Escalation rates** (`bench2-escalation-report.mjs`, rule 3, guard-detectable):
  Greek **0%** escalation with Kraken → 100% cheaper. German **0%** with Surya →
  79% cheaper (but n=2 ⇒ **UNDECIDED** under rule 5). Latin **40%** escalation →
  60% cheaper, which **FAILS** the preregistered ≥70% gate on the guard signal
  even though 100% of pages clear the accuracy gate. That gap between what an
  oracle would route and what the guard can *see* is the honest cost of having no
  ground truth in production, and it is the thing to engineer next.
- **Universally hard pages** (every arm, including Gemini): the ~1490 Malleus
  incunable and Praetorius 1615 (dense music-treatise layout). Specialist failures
  are guard-visible; Gemini's are fluent — the Bench 1 asymmetry, replicated on print.
- **Replicated?** **No.** Specialist arms are k=1; Gemini k=3 best-of. Determinism
  spot-check and a ≥20-page-per-segment diplomatic set are prerequisites for any
  reroute decision (see 2026-09-02 below for why k=1 is not a finding).
- **Artifacts.** `results/scorecard-outputs-2026-09-03.jsonl` (all 5 arms),
  `results/bench2-escalation-2026-09-03.json`, `results/scorecard--latin-la--greek-el--german-de---2026-09-03.json`;
  Kraken on `hetzner:/root/bench2-kraken/`, GPU work on archived Scaleway
  `sl-ocr-gpu-test` (`/root/bench2/`, ~€0.66/mo storage, reusable).

## 2026-09-03 — Bench 2 first arms (superseded by the entry above)

- **Design.** As above, Kraken + Gemini only.
- **Result (interim — CHURRO/Surya GPU arms pending L4 stock).** Diplomatic tier:
  - **Latin:** Kraken ≈ Gemini. Agricola 1556 99.2/99.5, Copernicus 1543
    98.7/98.7, Linnaeus 1735 98.2/99.4. Both arms fail the same two hard pages
    (Malleus ~1490 incunable; Praetorius 1615) — Kraken loudly (guard-fail,
    59–73%), Gemini by alignment failure. Kraken cost ≈ €0 (Hetzner CPU,
    ~20–50s/page niced).
  - **Greek:** Kraken **matches or beats** Gemini on every aligned page —
    Marinus 99.9/99.9, Bekker 99.9/99.4, Orphica 99.2/99.2, Parthey apparatus
    94.3/91.9; 99.7–100.0 on Teubner canonical (Philo/Simplicius/Hero). Caveat:
    all diplomatic Greek pages are 19th-c editions; on the one 16th-c Greek
    print page (Dioscorides 1549 Ruel) Kraken guard-fails at 88.4%.
  - **German Fraktur:** Kraken **loses badly** (72.8–89.1%, all guard-fails) —
    CATMuS-Print is not a Fraktur model. Gemini 99.6%. Needs a Fraktur-specific
    arm (GT4HistOCR/austriannewspapers lineage) before any German decision.
  - Failure asymmetry confirmed on print, matching Bench 1: every Kraken failure
    is guard-visible (loud); Gemini's weak pages align plausibly.
- **Replicated?** Not yet — Kraken k=1 (determinism check pending), Gemini k=3
  best-of. No reroute decision until GPU arms + paired stats run.
- **Artifacts.** `results/scorecard-outputs-2026-09-03.jsonl` (both arms),
  `results/scorecard--latin-la--greek-el--german-de---2026-09-03.json`,
  Kraken raw + models on `hetzner:/root/bench2-kraken/`.

## 2026-09-02 — Does OCR prompt v17 reduce fabrication vs v15?

- **Design.** Paired, k=5 runs per (page, arm), page as unit of analysis,
  positive + negative controls, decision rule pre-registered.
  `scripts/eval/prompt-ab.mjs`.
- **Result.** **INCONCLUSIVE, and the first-pass finding was retracted.** A
  single run per arm showed v17 cutting a fabricated page from 24,108 → 1,286
  body chars. At k=5 that page's SD was **±10,222** — the "finding" was one draw.
- **Replicated?** **No — it reversed.** Two independent k=5 runs put the runaway
  loop on *opposite arms*:

  | | run 1 | run 2 |
  |---|---|---|
  | p.118 v15 | 16,264 ±0 | 554 ±65 |
  | p.118 v17 | 348 ±4 | 16,232 ±0 |

  ~16.2k is the **output-token cap**: a degenerate repetition loop running to
  truncation. It lands on either arm, and within a batch of 5 it is all-or-none
  (±0, agreement 1.000), which is exactly what makes one batch look decisive.
  Arms verified distinct by `content_hash`.
- **What this means for method.** Body-length *means* are the wrong estimator
  when the failure is a categorical catastrophe. Needed: a repetition classifier,
  **loop rate as a Bernoulli outcome**, length statistics on non-looped runs
  only, and tens of runs per arm. k=5 cannot estimate a rate this volatile.
- **Artifacts.** `results/prompt-ab-v15-v17-{lacuna,blank}-2026-09-02.json`,
  `…-lacuna-2026-09-02-amended.json`. PR #4610, issue #4195.

## 2026-09-02 — Does #4195's blank-page narrowing work?

- **Design.** Same harness, `--cases blank`.
- **Result.** **Yes, on the faint-mark page** — v17 classifies Kitāb al-Bulhān
  p.4 as `text` on 5/5 runs where v15 said `blank`. I had reported the opposite
  from a single run.
- **Replicated?** Single k=5 run; stable within it (5/5), not repeated across
  sessions.
- **Counter-finding.** v17 **over-declines** elsewhere: p.197's legible Latin
  note ("Nihil hic deesse videtur") becomes a `<lacuna>`. That is the trade
  #4195 warned about, running in the direction nobody was watching.
- **Consequence.** v17 not promoted; PR #4605 labelled `blocked`.

## 2026-09-02 — Is a similarity gate a workable way to stop duplicated work?

- **Design.** Replay all 2,043 watched files as if newly created; sweep the
  block threshold; require the four real duplications of that day to keep firing.
  `.claude/hooks/calibrate-prior-art-guard.mjs`.
- **Result.** **No.** Four rounds of tuning could not get the firing rate below
  ~30% while keeping the true positives:

  | threshold | would block | true positives |
  |---|---|---|
  | 0.60 | 49.1% | 2/2 |
  | 0.70 | 33.2% | 1/2 |
  | 1.00 | 29.9% | 1/2 |

  In a repo organised into families (`ft-*`, `build-*`, `report-*`) the base rate
  of legitimate similarity is high, so a ranked filter's precision tracks it.
- **Consequence.** The gate was redesigned to be **unconditional** — declare
  prior art in any new file under watched roots — with the similarity list
  demoted to advisory. Nothing to tune, nothing to argue about.
- **Two ways the probe lied before it worked**, both worth remembering: it
  replayed existing paths that the guard skips and reported a reassuring **0%**;
  and it invoked a hook path that did not exist, where `else allowed++` counted
  every failed spawn as a pass. A probe needs a positive control, and absence of
  a signal is not evidence of a pass.
- **Artifact.** PR for `.claude/hooks/prior-art-guard.mjs`.

---

## Older runs — not yet back-filled

`results/` holds dated artifacts going back to 2026-04 (calibration scorecards,
blank-page study, revision-agreement pilots, cross-model comparisons, the
occlusion pilot). Their conclusions live in
`.claude/docs/ocr-quality-measurement-loop.md`,
`.claude/docs/ocr-memorization-paper.md` and the issues that commissioned them —
**not** here. Back-filling them is worthwhile but has not been done, and this
section exists so nobody reads the gap as "nothing was run before September".
