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

## 2026-09-05 — How wrong is the ground truth? (Track B item 1, #4523)

- **Question.** Every engine accuracy we quote is `1 − CER(reference, output)`. At 98–99%
  the residual is a few characters per page. If the reference is wrong at the same rate,
  the engine ranking is inside our own noise and nothing downstream is quotable.
- **Design.** No hand transcription — and deliberately no VLM re-transcription, which
  would referee a bench about VLMs with the system under test. Wikisource pages carry
  their own second opinion: `level 3` = one human transcribed it, `level 4` = a second,
  different human re-read it against the scan. `reference-error-rate.mjs` replays each
  page's revision history and measures what the validator changed, through the same
  `normalizeForScript` folding the bench scores through, so the number is on the bench's
  own scale. Restricted to independent validators and to pages whose predecessor was
  genuinely level 3 (a level-1 predecessor is raw OCR and prices the whole proofreading
  pass — one such page carried 10.9% into a 1.1% Latin sample).
- **Result — the reference is NOT the constraint for Greek, and IS for Latin.**
  n=69 pages (pinned set + a matched level-4 harvest per wiki), median 0.00%, 39 exact.

  | | level-3 reference error (A) | level-4 residual (B) | reported engine gap |
  |---|---|---|---|
  | Greek (n=18) | **0.07%** CI [0.02, 0.13] | 0.00% (5/5 exact) | 1.5pp |
  | German (n=15) | **0.06%** CI [0.02, 0.11] | 0.01% | — |
  | Latin (n=36) | **1.15%** CI [0.17, 2.47] | 0.48% | 1.4pp |

  Greek and German engine differences are 20x the reference noise and stand. **The Latin
  comparison does not** — the reference error and the reported Kraken-vs-Gemini gap are the
  same size, which is the arithmetic behind "Latin is a tie". Latin's distribution is
  skewed, not uniformly bad: most references are exact and a handful omit a whole printed
  block (an apparatus criticus, a clause), so the median is 0 and the mean is 1.15%.
- **The bigger error was OURS.** Instrument C compares the two cleaners: the pre-fix
  `cleanPageText` deleted a formatting template together with the text it wrapped —
  `{{SperrSchrift|D’Glocke het zwölfi gschlage.}}` is a printed line, not scaffolding.
  Measured **6.0% of Greek reference letters, 3.8% of Latin, 0.9% of German**, single pages
  losing 40–100%. That is 5–80x the human reference error. Worse, deeply nested apparatus
  markup survived as literal braces: the Poemander reference was 1,178 characters of
  `{{κσχασ|εδάφιο=1|σημείωση=μου] μεν A, om Turn. Fluss.}}` soup where the page prints 383
  characters of Greek.
- **Consequence, measured on stored outputs (no re-runs, no cost).** Re-scoring the
  Gemini-lite arm against the corrected references: Greek conditional accuracy **97.8% →
  99.6%** on coverage 92% → 88%; Latin 96.3% → 96.0%; German unchanged. The single page
  that drove it went **59.7% → 100.0%** — a perfect transcription charged 40 points for our
  markup. Coverage fell because a table-of-contents page that the corrupted reference let
  through now fails the guard honestly. **The Greek correction (1.8pp) is larger than the
  Greek engine gap it was used to judge (1.5pp), so the Bench 2 Greek result must be
  recomputed for every arm before it is quoted again** — the Kraken ws outputs live in
  PR #4651 and were not available to re-score here.
- **What the instrument cannot see:** errors both readers share, and the 79/149 pages
  nobody validated. Pages volunteers chose to validate are the well-loved ones, so this is
  a lower bound.
- **Artifacts.** `scripts/eval/reference-error-rate.mjs`,
  `scripts/eval/refresh-ws-references.mjs`, `results/reference-error-2026-09-05.json`,
  8 new unit tests in `tests/unit/wikisource-text.test.ts`.

## 2026-09-05 — A fabrication detector that needs no reference (Track C, #4523)

- **Question.** Every metric we own compares OCR to a reference. A model that has memorised
  the published text scores *well* on that comparison while never reading the page — Bench 1
  E4 caught one folio where Gemini hit 0.790 against the Derge canon while agreeing 0.33 with
  both specialists' reads of the same image. Production has no reference at all. Can the
  failure be detected without one?
- **Design.** A CTC line recogniser carries no language model over the target text, so it
  cannot recite; two independently-trained ones converging is evidence about the ink rather
  than about any edition. `fabrication-detector.mjs` scores three signals per page — specialist
  convergence (`ink`), VLM-to-ink agreement, and unit overrun — and abstains when the
  specialists do not converge. Every agreement is computed order-sensitively *and* order-free
  (multiset Dice over 3-unit shingles); a page is flagged only when both are low.
- **Validated on two sets with known answers, 349 pages.**
  Positive: Bench 1 Derge Kangyur, 313 folios, two BDRC recognisers + production-era Gemini.
  51 pages carry an externally-established label — Gemini below 0.2 against the canon where
  *both* specialists exceed 0.8, which no reading of the image can produce. Negative: the
  Bench 2 print arms in this repo, Kraken + Surya + Gemini on the same 36 pages.

  **51/51 positives flagged, 0/5 false positives**, and the threshold plateau is wide:
  precision and recall are both 100% for every gap threshold from 0.10 to 0.40. The default
  0.35 sits in the middle of that plateau rather than on a cliff, which is the answer to
  "the guard threshold was picked by hand".
- **Order is not failure — and it nearly cost 8 of 11 print pages.** On the Bekker
  *Categories* page Kraken reads across the gutter of a two-column setting while Surya reads
  down the column: order-sensitive agreement **0.01** between two engines that both transcribe
  it well. Gating on the sequence number sent those pages to INCONCLUSIVE for a layout reason.
  Every quantity is now the better of its ordered and order-free form.
- **The blind spot is the highest-risk population, and it is the real finding.** Recitation and
  specialist failure share a cause: a hard image is what makes a CTC engine fail *and* what
  pushes a VLM onto its memory. So "abstain when the ink is unestablished" silently excuses
  exactly the pages that matter — the seven most flagrant Bench 1 cases (Gemini 0.75–0.98
  against the canon while both specialists scored 0.00–0.16 against it, emitting up to 13.5x
  the units on the page) all sat in INCONCLUSIVE. A canon-anchored rule recovers 9 of them as
  a separate `RECITING?` verdict, reported apart from the verified ones because the
  specialists being broken is a live alternative explanation.
- **Overrun is the famous tell and it is not the useful one.** Across the 203 flagged Tibetan
  pages the median overrun is 0.93x, and only 38/203 exceed 1.6x. The agreement gap carries
  the signal; syllable count catches the spectacular cases only.
- **Coverage is the constraint, not accuracy.** Only 56 of 349 pages are both labelled and
  judgeable. On print, 6 of the 11 pages with a VLM arm are gated out because Kraken and Surya
  genuinely disagree — Copernicus 1543, the ~1490 Malleus, Weigel 1618, Zesen 1645, the
  Poemander apparatus page, Bekker. Two specialists that fail together buy nothing.
- **The validation's own weakness, stated plainly:** the positive and negative classes differ
  in script, medium *and* engine set. Perfect separation between conditions that different is
  evidence the statistic orders known-bad above known-good — not that it discriminates *within*
  early modern print. That needs a print corpus with known fabrication, which we do not have.
- **Artifacts.** `scripts/eval/fabrication-detector.mjs`,
  `results/fabrication-detector-2026-09-05.json`. Bench 1 case files are built from ops
  `eval-tibetan/` + `hetzner:/root/tibetan-eval/pages-*.jsonl` and are not committed here.
