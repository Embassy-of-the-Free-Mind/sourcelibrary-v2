---
stage: ocr
measure: [agreement, judged]
languages: [la, grc, de, fr, it, nl, ar, he, fa, zh, lzh, bo, sa]
scripts: [Latn, Grek, Arab, Hebr, Hani, Tibt, Deva]
canons: []
n_books: 3179
n_pages: 10695
status: informational
feeds: [detector, judge]
superseded_by: null
router_evidence: "none — no route was compared; this tests what the page-risk predictor's labels measure"
defect_rates: "none — nothing new was judged; it re-reads stored verdicts"
verdict: "The 46% cross-instrument agreement behind 'serious is unpredictable' was a selection artefact: lane B rewrote every page its own check called bad, so its fresh labels on the 217 pages shared with the weekly audit are 0% serious and its serious labels are of replaced text. No independent second reading of the same text exists at scale, so the agreement ceiling is unknown. Frame leakage is modest for 'any serious' (frame-only AUC 0.70; pooled 0.81 falls to 0.785 within method) and large for 'text not on the leaf' (0.83 to 0.68). Within the uniform frame the target decides: serious OCR error or wrong leaf AUC 0.854, any serious 0.756, not on the leaf 0.739. Minor findings carry no signal (rho +0.11 with the 1-5 score; AUC 0.43 for a serious re-read finding)."
decision: "No production write, no spend. A severity rubric (SEVERITY-RUBRIC-PROPOSAL.md) and a 120-page calibration set (CALIBRATION-SET-DESIGN.md) are proposed; running the Gemini half and two hours of Derek's time are DECISION lines on #6420. Aim audits with the OCR-critical target meanwhile."
---

PRIOR ART: `2026-11-11-error-zoo-v2-all-labels-6420.md` (the predictor and the 46% figure this re-examines);
`scripts/audit/convergent-audit-lib.mjs` (`kindAgreement`, two readers on one packet); `.claude/docs/measurement-validity.md`.

## 2026-11-12 · Is "serious" a thing we can predict? (#6420)

**Who reads this.** Derek, and whoever next aims an audit or a repair with the risk score.

**The question** (Derek and a colleague): the instruments agree on 46–50% of shared pages and their serious counts
correlate at ρ 0.49, so is the predictor learning errors or instruments? Script: `scripts/eval/error-zoo/instrument-leakage.py`;
full tables: `scripts/eval/error-zoo/leakage-report-2026-11-12.md`. Free: stored labels only.

### 1. The 46% does not measure reader disagreement

| shared pages, lane B check (`ocr-convergence`) vs weekly audit (Opus) | n | lane B serious | audit serious | raw agree | κ |
|---|---|---|---|---|---|
| every shared label, any serious (as first reported) | 483 label pairs | 10% | 48% | 46% | −0.11 |
| both labels on unchanged text, any serious | 217 pages | 0% | 51% | 50% | 0.00 |
| both labels on unchanged text, serious OCR or wrong leaf | 217 pages | 0% | 11% | 89% | 0.07 |

Lane B wrote every page its check flagged, so a lane-B label that is still about the served text is, by construction, a
pass. What the table measures is lane B's own sign-off against a later independent audit: **on pages lane B passed, Opus
finds a serious OCR error on 11% and a serious error of any kind on 51%**, mostly in the English, which lane B never
checked. The only other shared-page pair (`hide-broken-text` / `shelf-overview`, 59 pages, κ 1.00) is one Opus run's
labels derived from another's. There is no independent second reading of identical text anywhere at scale.

### 2. How much is the frame?

| target | base | pooled, all features | frame only | text + catalogue | mean within method |
|---|---|---|---|---|---|
| any serious | 43% | 0.842 | 0.699 | 0.814 | 0.785 |
| serious OCR or wrong leaf | 31% | 0.883 | 0.656 | 0.875 | 0.853 |
| text not on the leaf | 15% | 0.900 | 0.803 | 0.828 | 0.684 |

The text and catalogue features identify the judging method at one-vs-rest AUC 0.79–0.92 (provider, prompt version and
language mix differ by queue). For "any serious" the frame is worth about 0.03 of the pooled AUC. For "not on the
leaf" it is most of it: those labels live in a few targeted queues.

### 3. Within the uniform frame, the target decides

| target | audit base | pooled model in the audit | audit-only model | random books only |
|---|---|---|---|---|
| any serious | 36% | 0.705 | 0.734 | 0.756 |
| serious OCR or wrong leaf | 16% | 0.832 | 0.816 | **0.854** |
| text not on the leaf | 13% | 0.695 | 0.685 | 0.739 |

### 4. Reliability and the minor tier

- The Opus audit reader on 143 pages read twice on identical packets: κ 0.95 (any), 0.85 (OCR), 0.93 (not on leaf).
  An upper bound: same text, same frozen brief.
- Within that reader: 1–5 translation score vs serious count ρ −0.81, moderate −0.58, minor **+0.11**; 1–5 OCR score
  vs serious −0.49, moderate −0.48, minor −0.15. A minor count on the first read predicts a serious finding on the
  re-read at AUC **0.43**.

### What follows

- Two targets, not one: transcription-critical (predictable from text; aim audits and OCR repairs with it) and
  English-critical (not predictable from the text; needs a reader). Minors leave every rate.
- `SEVERITY-RUBRIC-PROPOSAL.md`: severity by consequence for a reader who quotes the page, span-marked, three bands,
  minors weight 0.
- `CALIBRATION-SET-DESIGN.md`: 120 pages, frozen text, Opus and Gemini under one rubric with re-reads, planted criticals
  and wrong-page controls, and Derek on 36–72 pages in four languages with prefilled spans. It produces the ceiling
  this note could not find.

### Limits

- Every label is a model's. No human-human or human-model agreement exists in the data.
- "Frame only" uses five columns; finer frame structure (a lane's queue order) is still inside "within method".
- The OCR-critical target is easier partly because it is rarer and more mechanical; its κ under a second family is
  unmeasured.
