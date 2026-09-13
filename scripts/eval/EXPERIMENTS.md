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

---

## 2026-09-12 — Does translation prompt v15 (#3825) make original-notes real?

**Headline: the verbatim rule works — verified-note rate 66.7% → 96.3% while
writing MORE notes — but v15 also suppresses interpretive notes by a third, and
the blind judge caught it. Not flipped; v16 = v15 + one sentence.**

- **Question.** v15 carries all five #3825 items; item 2 says the phrase inside
  `<note>original: "…"</note>` is copied character-for-character from the OCR
  or the note is omitted. Does it cut fabricated citations (12.2%, #3308)
  without gaming the metric by falling silent, and without losing content?
- **Design.** Pre-registered (`PREREGISTRATION-translation-prompt-v15.md`).
  Paired, one page per BOOK, 8 strata × 40 = 320 pages, both arms on
  `gemini-3.1-flash-lite` (flat, Derek's call — the full-flash routing rests on
  OCR evidence; #4759). Verifier = `scripts/lib/page-terms-parse.mjs`, the
  build-page-terms one. Blind 30-pair Claude judge on loss. $1.26.
- **Result.** Criteria 1–3, 5 pass: Δ +28.9 pp (CI [+14.7, +44.7]), sign test
  13–0; original-notes/page 0.42 → 0.77; invented tags −95%, housekeeping
  leakage −91%, inline terms +22%. Hebrew went 8% → 93% verified, Arabic
  29% → 100%: on those scripts v13's citations were mostly fabricated.
  Criterion 4 (body −26%) FAILS as written but is two v13 runaway loops
  (MAX_TOKENS, 96K/138K chars) that v15 refused with `<warning>`; excluding
  them −0.3%. Criterion 6 FAILS: judge 8:1 against v15 — 4 are running
  headers not reproduced (item 4 by design), 3 are interpretive notes not
  written. Corpus-wide interpretive notes fall 1.27 → 0.81/page, every
  stratum. The "omit the note" clause is being read beyond `original:`.
- **Replicated?** No. k=1 per (page, arm), one run.
- **Two instrument lessons.** (a) `<[^>]+>` as a tag stripper eats prose
  between `->centred<-` markers — fixed, control added. (b) A mean body
  length cannot carry a runaway-loop failure; `prompt-ab.mjs` said so in
  September and the plan did not inherit it. Amendment 1, prospective.
- **Artifact.** `results/translation-prompt-v15-report-2026-09-12.md` (+ .json,
  arms, judge packet/key/verdicts), PR #4758. v15 row stays `is_default:false`.

---

## 2026-09-12 — Can flash-lite text-only cleanup rescue rejected Internet Archive OCR?

**Headline: no lane. It raises agreement a little everywhere, lifts no rejected book over
the 0.85 gate, costs 86% of re-reading the image, and invents where the input is unreadable.**

- **Question.** `ia-ocr-ingest.mjs` (#4727, #4763) takes the Archive's free ABBYY text where it
  agrees ≥ 0.85 with our Gemini pages; 741 English books (136K pages) fail. Their errors look
  systematic (long s → f, broken words). Can `gemini-3.1-flash-lite`, text in / text out, no
  image, thinking off, push them over the gate cheaper than image OCR?
- **Design.** 10 books × 6 interior reference pages (pages with both IA text and Gemini OCR),
  two per agreement band from the dry run plus the two long-s probes at leaf offset −1. Word-
  sequence agreement with the Gemini reading before and after cleanup; length ratio to catch
  additions/deletions; three pages adjudicated by eye against the scan.
- **Result.** Median agreement before → after: ≥0.90 band 0.916 → 0.939; 0.85–0.90 band
  0.895 → 0.935; magazine title/index pages 0.612 → 0.617; Van Helmont 1662 0.669 → 0.755;
  1801–1803 long-s 0.700 → 0.775. 48/60 pages improved, 1 worse. Cost $0.076 = $0.00127/page
  (615 output tokens/page) vs $0.00148 measured lite-batch image OCR. Two of 60 pages changed
  length by more than 25%: an index page came back 1.98× longer with 7 of 8 author names
  fabricated (page says R. D. Mussey, H. W. Compton, Thomas L. Greene; model wrote John G.
  Nicolay, M. G. van Rensselaer, William L. Greene); on the Oriatrike title page the ink-blotted
  "Toparch or Governor" became "Lord of". Where the cleanup was right (Cabiri p.286: Areas →
  Arcas, Fejla → Vesta) the image reader had already been right.
- **Replicated?** No — single run, 60 pages. The cost figure is the load-bearing one and is
  arithmetic on token counts, not a sample.
- **Artifact.** `ia-ocr-cleanup-exp.mjs`; `results/ia-ocr-cleanup-2026-09-12.{jsonl,log}`
  (page triplets IA / cleaned / Gemini with scores and image URLs). Blog: `/blog/free-reading`.

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

## 2026-09-13 — How good is the IA OCR text we actually WROTE, and where should the cutoff sit? (#4780, #4763)

**Headline: the delivered text in the accepted bands has a median CER of 3.9% (WER 8%)
against a fresh flash-lite read of the same image; 84% of pages are within 10%, and a 10%
tail is above 20%. Quality degrades smoothly with the gate score — there is no cliff at
0.85 — so the cutoff is a policy choice, and it should differ by language: 0.80 for
English and French, 0.85 for Latin/German/Italian, and Greek should not be filled at any
score.** The two proposed refinements from the hand read on #4780 were tested and both
fall: a prose-page-only book score admits books whose delivered pages are mediocre
(median 9.1%), and the column-splice failure is page-local, invisible at book level.

- **Design.** One interior, previously-untranscribed page per BOOK (742 books) across
  agreement band × language — including the bands the gate REJECTS (0.40–0.85, text
  regenerated from the leaves cache exactly as the ingester would write it) — scored by
  CER/WER against a fresh `gemini-3.1-flash-lite` read via the eval-lib runner with the
  production prompt v16, thinking budget 0, the production document-context line. Per
  page also the gate's own sequence ratio, bag-of-words Dice and their gap; per book the
  gate re-scored with the current (#4783) logic as median-over-all, median-over-prose
  pages, and p75. Five hand-read anchor pages from the peer session ride along.
  `scripts/eval/ia-ocr-delivered-quality.mjs`; rows in
  `results/ia-ocr-delivered-quality-2026-09-13.jsonl` (image URL + both texts on every
  row). Cost **$2.49** (742 + 193 re-reads; $3.02/1K pages — realtime lite, not the batch
  rate the $1.20 estimate used).
- **By band, all languages (clean references only):** median CER 0.40–0.60 17.3% ·
  0.60–0.70 13.3% · 0.70–0.75 10.1% · 0.75–0.80 9.3% · 0.80–0.85 7.0% · 0.85–0.90 5.9% ·
  0.90–0.95 3.4% · 0.95+ 1.4%. Share ≤ 5% CER climbs 4% → 11% → 20% → 23% → 33% → 37% →
  71% → 97%. Pre-1800 pages median 12.0% vs 5.8% for 1800+ (Latin pre-1800 11.8%).
- **Per-language cutoff sweep (accepted median CER / share ≤ 5% / share > 20%):**
  English 0.85 → 2.7%/71%/6%, 0.80 → 3.3%/65%/7%, 0.75 → 4.3%/58%/6%; French 0.85 →
  3.2%/69%/8%, 0.80 → 3.4%/68%/8% (rejects below 0.80 hold ONE good page); Latin 0.85 →
  4.5%/61%/11%, 0.80 → 4.7%/52%/12%; German 0.85 → 3.2%/57%/13%, 0.90 still 15% > 20%;
  Greek 0.85 → 6.6%/29%/24% and n=5 at 0.90; Italian n=30, 0.85 → 2.1%/71%/14%.
- **The instrument, calibrated on the anchors.** The 0.95+ band medians 1.4%, so the
  reader-vs-reader floor is ~1–2%. The two pages a human called verbatim (Basil *Letters*
  0.353, Dance of Death 0.890) score **6.0% and 6.1% CER** — so ≤ 5% ≈ verbatim by eye,
  6–10% ≈ a few visible errors; the Latin page the human called garbage (*Oratio pro
  Ligario*, names corrupted) scores 7.8% CER / **23% WER** — word error rate is the
  better proxy for "names are wrong". The column-interleaved Century page scores CER
  1.02 with gap 0.25.
- **Bag-of-words minus sequence isolates 14 of 488 pages (gap ≥ 0.15), median CER 0.735
  vs 0.075 for the rest** — the label works. But every one of those pages sits in a book
  whose reference-page gap median is ≤ 0.04: **the splice is page-local (a spread, a
  two-column page), not a book property. A book-level splice gate would catch none of
  them.** CER already flags them as delivered text.
- **Prose-only book score: rejected.** Median |prose − all| = 0.007 — the statistic
  barely moves for most books. Where it does move (39 rejected books cross 0.85) the
  delivered pages median **9.1% CER**, worse than the 3.9% accepted median. The Basil
  case (facing-page Greek dragging a verbatim English book to 0.35) is real and rare; as a
  policy the prose score admits mediocre books.
- **Delivery errors: 31 of 573 pages (5.4%) show text and image as DIFFERENT pages** — the fresh
  read of the archived image fits leaf k±1 at seq > 0.5 while the delivered leaf scores < 0.3.
  Re-read from the SOURCE leaf the record points at (`pages.photo`, IIIF) and classified, because
  the two causes need OPPOSITE repairs: **24 text-side** (the source leaf matches the NEXT leaf's
  text: the gate's per-book offset was locally wrong — every one is "text one leaf behind", the
  Oxyrhynchus volumes worst; 2 already written), **5 image-side** (the text matches the source
  leaf; the archived R2 image is the neighbouring leaf — the #3368 bulk-JP2 leaf offset,
  `.claude/handoffs/2026-07-27-bulk-jp2-leaf-offset.md`; the TEXT is right; 2 written), 2 unclear.
  Mechanism for the text-side class: the reference pages are the book's FIRST 25 (the preview
  sample), so the offset is calibrated at the front and drifts by the interior; an 86% vote
  (`--min-offset-share` 0.60 passes it) was locally wrong. **A repair must classify first —
  shifting text to match the archived image would corrupt the image-side class.** Peer
  verification of the four written cases on #4790 (against IIIF, by printed page number) agrees.
- **Corpus-wide sizing, free and deterministic (`scripts/audit/ia-ocr-leaf-drift.mjs`).** IA's
  scandata marks leaves excluded from access formats; BOTH the IIIF page index and the djvu.xml
  OBJECT sequence skip them (access-leaf count == XML object count on 478/478 written books), so
  the correct offset is 0 for every book. The bulk-JP2 archived images (#3368) do NOT skip them,
  and the reference pages were OCR'd from those images — the offset vote fitted the XML to the
  wrong image set. **236 of 893 written books (26%), 51,851 of 152,997 written pages (34%), were
  written at offset −1/−2/−3 and carry the text of the wrong leaf against their own source.** The
  paid sample's "2 of 56" was a wide interval around the wrong quantity: at the front of an
  offset −1 bulk book the text matches the *shifted* image, so only pages past an interior
  excluded leaf were caught. Shown-image mismatch is an upper bound (98 books / 4,544 pages,
  assuming every bulk image set is shifted; Possidius is aligned, Century shift+1 — only the
  #3368 dHash audit can count it). Folio continuity inside the written text was tried first and
  is blind to this: a fixed shift of a continuous sequence (Open Court delivered folios
  355/356/357 vs archived 353/354/355 vs IIIF 356/357/358).
- **The 2×2 and the repair (same evening).** dHash of each bulk-archived written book's images
  against IIIF at the aligned vs the scandata-predicted leaf (`--stage=images`): CLASS A (images
  aligned, text offset ≠ 0 — reader sees the wrong text) **39 books / 940 pages, repaired**: 910
  pages re-pointed to offset 0 from the cache with revisions, 30 held (offset-0 leaf has no words),
  second run 0 changes; 7/7 readable IIIF re-reads confirm (new text 0.90–0.97 vs old 0.11–0.17).
  CLASS B (images shifted, text right) 42 / 2,270 → the #3368 image repair. **CLASS C (images
  shifted, text at a compensating offset) 188 books / 48,006 pages: text and image AGREE on screen
  except 2,062 pages past an interior excluded leaf — HELD**, must be repaired together with the
  images, images first. So the offset search mostly *masked* #3368 rather than breaking pages.
  Ingester now forces offset 0 and refuses a non-zero vote as `REF_SHIFTED`.
- **Refusals are the instrument's big limit.** 193/742 first-pass references (26%) came
  back RECITATION/PROHIBITED_CONTENT because the run omitted production's document-context
  line; adding it recovered only 24, leaving **169 (23%) unscored — concentrated in the
  cleanest, most recitable print (78 of 169 in bands ≥ 0.85)**, so the accepted-band
  figures are, if anything, pessimistic. The production tier-2 retry (flash-preview)
  would cost ≈ $0.80 more and was not run (over the $3 cap). A further 56 references were
  degenerate (40 hit MAX_TOKENS in a loop — flash-lite on dense Latin/German/Greek pages)
  and are excluded. Stored-text check: 70 pages read from `pages.ocr.data` matched the
  regenerated leaf exactly, all 70.
- **Decision:** per-language cutoffs (English/French 0.80; Latin/German/Italian 0.85;
  Greek: do not fill); force offset 0 in the ingester — a non-zero vote means the reference
  pages were read from #3368-shifted images, a tell to refuse on, not a calibration; re-pair the
  236 books' written pages at offset 0 from the cache (no model calls), images FIRST or both per
  book, since at the front the text currently matches the shifted image.
  Issue: #4790.
