---
stage: translation
measure: judged
languages: [la]
scripts: [Latn]
canons: []
n_books: 48
n_pages: 48
verdict: "A blanket 'prefer the cognate, keep the author's distinctions' line fixes the terms it names (concordia → concord 89% vs 44–67%) but reads worse (judge 4 wins / 28 losses vs noise 13/17) and adds false friends (schedules, insinuate, habit); held-out terms were already at ceiling. Not established."
status: rejected
decision: "Keep v13; target the concordia-type trap with the per-book glossary (#4741), not a general cognate rule"
superseded_by: null
issue: [4741]
---
<!-- PRIOR ART: 2026-10-03-translation-prompt-v16-3825.md and 2026-09-12-does-translation-prompt-v15-make-original-notes-real-3825.md (the same v13-vs-candidate design on note behaviour; neither measures term rendering). -->

## 2026-10-26 · Does a "prefer cognates, keep the author's distinctions" line make Latin translations keep the author's vocabulary? (#4741)

**Question.** Spinoza's *concordia* was rendered "harmony" on 35 pages across four editions (corrected 2026-10-26).
That erased a distinction Spinoza draws himself: Ethics I App. dismisses *harmonia*. Would a general line in the
prompt fix this class of error? The candidate line says to use the English cognate where its meaning matches, never
to render two source words with one English word, and to watch for false friends.

**Design.**
- Arms: `v13a` (the live default), `v13b` (v13 again, the A-vs-A noise floor) and `v19` (v13 plus the KEY TERMS
  block). The block's examples name only *concordia* and *consonantia*.
- Pages: 48 Latin books, one page each, in three strata:
  - T, 24 books: key terms (concord / consonan / sympath / proporti / symmetri / temperament);
  - F, 12 books: false-friend candidates (virtus / experimentum / convenientia / religio);
  - C, 12 books: control.
- Calls: realtime `gemini-3.1-flash-lite`, temperature 1.0, thinking off, no continuity text.
- Pre-registration: `PREREGISTRATION-translation-cognate-4741.md`, committed and pushed before any output.
- Runner: `translation-cognate-ab-4741.mjs`.
- Blind pairwise judge: 8 Claude Opus subagents; 108 pairs, of which 48 cand, 48 noise and 12 same-arm controls.
- Spend: **$0.30** for 144 calls, with no failures or refusals.

**Result: not established; keep v13.**

| measure | v13a | v13b (noise) | v19 |
|---|---|---|---|
| named terms (*concordia*, *consonantia*) kept as cognate, 9 pages | 44% | 67% | **89%** |
| held-out terms kept as cognate, 17 pages | 53% | 53% | 53% (instrument defect, below) |
| "harmony" in the body where the Latin has no *harmonia* | 3 | 2 | **0** |

| judge, 48 pairs per kind | v19 vs v13a | v13b vs v13a (noise) |
|---|---|---|
| fidelity (first / second / tie) | 16 / 19 / 13 | 13 / 14 / 21 |
| readability (first / second / tie) | **4 / 28 / 16** | 13 / 17 / 18 |
| serious meaning errors (first, second) | 30, 35 | 30, 28 |
| false-friend errors (first, second) | 36, 32 | 28, 24 |

Here "first" means v19 in the cand pairs and v13b in the noise pairs. The same-arm control tie rate is **100%**
(12 of 12), so the judge is not inventing differences.

**Pre-registered rule.**
1. Held-out fidelity +0.00: **fails**. The failure is an instrument defect plus a ceiling (see below).
2. False friends in F: 11 vs 7, which **fails** the +1 margin. The noise pair in F is 10 vs 8.
3. Serious errors: 30 vs 35, passes.
4. Readability in C: net −4 against a noise |−3| + 2, passes narrowly. Overall readability is 4 wins to 28 losses
   against a noise of 13 / 17, which is the clearest signal in the run.
5. Control ties: 100%, passes.

**Why.**
- **The default is already the cognate.** Every genuine held-out Latin term (*proportio*, *sympathia*,
  *temperamentum*) was rendered with its cognate by all three arms. The *concordia* error is narrower: it happens
  where English has a more idiomatic near-synonym ("live in harmony" for *concorditer vivere*).
- **A general rule overcorrects.** The judges' reasons on v19's losses name new false friends:
  - *schedulae* → "schedules";
  - "insinuate his death";
  - *habitus* → "habit";
  - "interpellating", "provocation".
  The prose is also stiffer. The warning sentence about false friends did not hold the line.

**Instrument defects, reported, not fixed in the score.**
- **Held-out matches were not Latin.** All 8 *symmetri* hits in stratum T were the English word "symmetrical" in
  `<image-desc>` captions inside the OCR, which the translations move into `<note>`, outside the scored body. So
  none of the three arms could score there. The corrected held-out set (genuine Latin terms only) is 100% for every
  arm: no headroom.
- **Packet bug.** The first packet build attached a page's English to the previous page's Latin on 36 of 108 pairs
  (a `slice(-3)` on units with two pairs). Two judges flagged it. The bug was fixed, and the 36 pairs were rebuilt
  with unchanged ids and A/B order (`judge-key.json` is byte-identical) and judged fresh. Their first verdicts are
  discarded by the scorer (`rejudge-ids.json`).

**Grade.** 48 books, `directional`; one judge per pair, so there is no α.

**Next.** Target the trap rather than the habit. The per-book glossary (#4741) can carry the pairs that actually go
wrong (*concordia*/concord vs *harmonia*/harmony, using the harmony concepts added in #7409) without telling the
model to prefer cognates everywhere. A second held-out set should be chosen for idiomatic-near-synonym traps
(*imaginatio*, *affectus*, *commercium*, *ingenium*), not for terms the default already renders as cognates.
