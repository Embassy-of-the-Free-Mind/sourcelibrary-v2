# Note-quality eval — Phase 2 (model-judged spot check)

**Issue:** #3308 · **Run date:** 2026-07-22 · **Cost:** $0 (subscription Claude subagents only; the Gemini second-vendor lane was not run — see Method) · **Precedes:** Phase 3 human review (pending) — **do not quote these error rates externally until Phase 3 signs off.**

## Method

- **Input:** the Phase 1 stratified sample (n=400) drawn from the Phase 0 corpus scan (see `note-quality-eval-phase0.md`): 100 notes per class, with the original-phrase class deliberately oversampling Phase 0's candidate-fabrication tail (60 miss / 30 exact / 10 fuzzy). 397 items were judgeable (3 excluded as degenerate repetition-loop pages; 99 required deterministic tie-breaks when locating the note span, flagged `tie_broken`).
- **Judges:** two independent Claude (Sonnet) agents per item with opposing framings — a neutral examiner and an adversarial refuter — each reading the **page image** (ground truth; the stored OCR may itself be wrong) plus OCR, translation context, and the note span. Verdict schema per the issue: provenance / grounding / accuracy / rationale / on-page evidence.
- **Adjudication:** material disagreement (accuracy bucket or source-derived↔ai-authored clash) → a third agent re-judged from scratch. 120/397 items (30.2%) were adjudicated; 0 unresolved.
- **Vendor-diversity caveat:** both judges share one vendor, so correlated blind spots are possible. Mitigations: opposing framings, evidence-quoting requirement, and the pending human pass. A Gemini lane over only the disagreements remains a cheap upgrade (~$1–3) if Phase 3 shows systematic judge error.
- **Raw artifacts** (untracked, Derek's main checkout, `scripts/output/note-quality-phase0/`): `phase2-items.jsonl` (bundles), `verdicts/` (113 per-lane files), `phase2-verdicts.jsonl` (merged), `phase3-slice.jsonl` + `phase3-review.html` (human-review queue).

## Results (n=397 judged)

Accuracy overall (raw sample — NOT population rates; the sample oversamples suspected-bad notes): 260 correct / 31 minor / 69 wrong / 32 unverifiable.

### Per class — judged wrong, with Wilson 95% CIs

| Class | Wrong (sample) | 95% CI | Population estimate |
|---|---|---|---|
| original-phrase | see strata below | — | **8.6% weighted** |
| explanation | 12/100 = 12.0% | 7.0–19.8% | ~12% |
| image-desc | **31/100 = 31.0%** | 22.8–40.6% | ~31% |
| interpolation-other | 12/97 = 12.4% | 7.2–20.4% | ~12% |

### Original-phrase strata (calibrating Phase 0)

| Phase 0 verdict | Pool | Judged wrong | 95% CI |
|---|---|---|---|
| miss (candidate fabrication) | 15,711 | 12/60 = 20.0% | 11.8–31.8% |
| exact match | 97,799 | 2/30 = 6.7% | 1.8–21.3% |
| fuzzy match | 3,718 | 1/10 = 10% | 1.8–40.4% |

Population-weighted wrong rate for the class: **≈8.6%** (dominated by the exact-match stratum's small n — the true value is anywhere in roughly 3–18%).

**Key calibration finding: most Phase 0 "fabrication candidates" are false alarms.** Of 60 judged misses, 37 (62%) are *correct* notes the string matcher could not see — romanization variants, abbreviation expansion, and OCR errors on the page side (several judges found the note more faithful to the page image than the stored OCR). True verbatim fabrication in the class ≈ 12.2% × 20% ≈ **2–3%**.

**Inverse finding: exact string match ≠ correct note.** 2/30 exact-match notes were judged wrong — the phrase is on the page but the note misuses it (canonical example, row 5: an English translation labeled `original:` while the true original is the page's Latin). Gate A cannot treat string-verified as fully verified without bounding this failure mode (top priority for Phase 3 human eyes).

### Grounding & provenance (all classes)

- grounding: on-page 309 / external-knowledge 45 / **ungrounded 27 (6.8%)** / adjacent-page 16 (4.0%)
- provenance: ai-authored 222 / source-derived 126 / mixed 49 — a majority of served note content is AI-composed, which is the substance of the #2709 labeling question.

### By prompt era (Gate C)

Wrong-rate by prompt_version (n≥15): v10 37/207 (17.9%), v11 30/160 (18.8%), v2 1/18. Current prompts are NOT measurably cleaner on *content* accuracy than each other (v2's small n is not evidence of a golden age). Combined with Phase 0's finding that *structural* compliance is already clean, the lever is a content-grounding contract in prompt v-next, not formatting.

## Gate readings (provisional, pending Phase 3)

- **Gate A (mark original-phrase as verified source):** NOT passable as a blanket claim. Even the exact-match stratum shows a nonzero mislabel rate (6.7%, wide CI). Path: human-verify the exact-match failure mode in Phase 3; if it lands ≤~2%, exact-match notes (88K in the Phase 0 sample frame, ~84% of the class) can be marked verified-with-known-error-bound.
- **Gate B (reader labeling):** SUPPORTED, strongest for image-desc (31% wrong) and for the 222/397 ai-authored notes generally. Recommend "AI note" labeling per #2709 for ai-authored/mixed provenance classes rather than silent gold styling.
- **Gate C (prompt v-next):** failure modes are *still being written* (v10/v11 ≈ v-older on content error). Prompt contract should require notes to quote only what is on the page and label AI additions — a write-time fix, not just read-time.

## Known limitations

- Judge vendor monoculture (mitigated, not eliminated — see Method).
- The 99 tie-broken note attachments could pair a verdict with a neighboring note of the same class/length; spot checks were clean but Phase 3 includes tie-broken items.
- `interpolation-other` is a heuristic catch-all; its 12% wrong likely blends distinct sub-failure-modes.
- Population weights come from the Phase 0 250K-page subset, not the full corpus.
