---
stage: ocr
measure: accuracy
languages: []
scripts: []
canons: []
n_books: null
n_pages: null
verdict: "gemini-3-flash-preview reads Shaker letteral pitch poorly (interval NER 0.19) and rhythm at 0.49; on mensural staff it read the printed syllables, not the staff (0.42)."
status: rejected
decision: "VLMs not used on score pages; score against ground-truth first (music-notation.md)"
superseded_by: null
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
