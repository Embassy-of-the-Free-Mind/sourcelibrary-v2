---
stage: translation
measure: [judged]
languages: [pli]
scripts: [Latn]
canons: []
n_books: 8
n_pages: 16
verdict: "Opus beats the stored 3 Flash English on Pali under both judges: Opus judge 15 of 16 pages, +1.06 fidelity points (1-5) [0.56, 1.56]; Gemini 3.8 Flash high judge 13 of 16, +1.13 [0.38, 1.81]; both judges passed both wrong-page controls; by eye 3 of 3 Opus reads faithful. The rule passes and Pali moves to the Opus CLI lane (row pali-cli-opus)."
status: adopted
decision: "pali-cli-opus row added to scripts/lib/translation-routing-table.json (#7075)"
superseded_by: null
issue: [7075, 7170]
---
## 2026-10-23 · Does Opus translate Pali better than 3 Flash, before the Pali row moves to the CLI lane? (#7075)
<!-- PRIOR ART: 2026-10-15-planner-v0-expected-loss-6740.md (the posterior that says P = 1.0 Opus beats 3 Flash on Pali,
from rounds that were not Pali-specific in volume); route-proposals-2026-10-23.md (the LANE row this gates). -->

**Why.** The planner and derive_routes.py (re-run today) say Opus beats 3 Flash at Pali translation with P ≈ 1.0. Pali
is the smallest LANE row (324 read-weighted pages), so it is the first to move to a subscription CLI lane. #7075 step 3
asks for a 20-page blind sample against the old reader before a row goes live.

**Design** (`scripts/eval/translate-cli-lane-7075/sample.mjs`; the rule was fixed in its header before the first run).
- **Frame:** visible Pali books whose stored English came from `gemini-3-flash-preview`. 26 visible Pali books, but only 8 carry 3 Flash English (781 eligible pages). Most Pali English is lite.
- **Draw:** 20 pages, seeded, one per book first. The same-language guard skipped 4 English apparatus pages, leaving **16 pages in 8 books**. The effective n is closer to 8 than to 16.
- **New reader:** Opus through `claude-translate.mjs read`, the lane's own reader, on the production block prompt.
- **Judging:** blind X/Y with a seeded side, fidelity 1-5, plus 2 wrong-page controls.
- **Judges:** Opus (`claude -p`) and Gemini 3.8 Flash high (`agy -p`).

**Result.**

| judge | n | controls | new wins / old / tie | new − old (1-5) | 95% CI |
|---|---|---|---|---|---|
| Opus | 16 | 2/2 | 15 / 1 / 0 | +1.06 | [0.56, 1.56] |
| Gemini 3.8 high | 16 | 2/2 | 13 / 3 / 0 | +1.13 | [0.38, 1.81] |

- Two of the old reader's pages were scored 1. On one it invented connected Paṭṭhāna content. On the other it translated only the header.
- The one old win under the Opus judge: Opus added an unsupported meta claim about the brackets.
- Gemini's three old wins:
  - Two penalise Opus's added `<summary>`/`<keywords>`/meta blocks. Those blocks are the production prompt's output format, not page text.
  - The third (*Dhātukathā* title page, 6a09ff1d…89ab) says Opus "omits the vocabulary section". That "section" is the OCR's own `<vocab>` metadata tag, not printed text. Opus was right to leave it out, and the old read turned the tag into body text. This is a judge error, and the by-eye check below stands.
- Two-judge mean: +1.10. That beats the planner's prediction of ≥ 0.3.

**By eye (rule 3), three Opus reads against the source:**
- Title page, *Dhātukathā* (6a09ff1d…89ab): exact.
- Dukapaṭṭhāna p. 135 (6a09ff16…dc56): every clause right. The only addition is the hedged bracket note, the same one the judge marked.
- Rhys Davids' Vibhaṅga preface (6a09ff00…d974): faithful. It stops where the page stops. The old 3 Flash read carried footnote 2 on with the next leaf's text (Stönner, 1904), a not-of-leaf error.

No invented passage in the Opus reads.

**Self-preference caveat.** Opus judged Opus, so the rule also needs the Gemini judge. The Gemini judge (other family,
run 2026-10-23 ~22:45 UTC) agrees on direction and size, so the result is not just self-preference.

**Decision.** All three rules pass. The `pali-cli-opus` row (`channel: "cli"`, `claude-opus-5-5`, replaces
`gemini-3-flash-preview`) is now the first row of `scripts/lib/translation-routing-table.json`. 60 of the 61 books with
"pali" in their language label route to it, and Batch callers still see 3 Flash underneath. The first live
`cli-translate-lane.mjs --apply` run and its by-eye check belong to the session that owns #7075.

Results: `scripts/eval/translate-cli-lane-7075/results/pali-2026-10-23/`.
