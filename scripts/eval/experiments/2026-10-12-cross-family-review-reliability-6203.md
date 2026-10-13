---
stage: translation
measure: agreement
languages: []
scripts: []
canons: []
n_books: 33
n_pages: 33
verdict: "Half run: Opus read all 33 pages and caught 3 of 3 planted controls with the right kind. The Gemini half did not run (the agy CLI is on the main box only, and that box took no jobs), so there is no kappa and 'convergent' is still not a validated reliability claim."
status: undecided
decision: "none yet: finish with scripts/eval/cross-family-6203/finish-gemini.sh on the main box, then read kappa per kind (#6203, #6420)"
superseded_by: null
issue: [6203, 6420]
---
## 2026-10-12 · Do an Opus reader and a Gemini reader agree, kind by kind, on the same 30 pages? (#6203 validation run; half run)
<!-- PRIOR ART: 2026-10-09-second-reader-pilot-gemini-cli-6338.md and the #6338 calibration (Opus vs Gemini 3.1 Pro agreed at chance, alpha -0.13, on "serious" severity); the weekly #6420 lane D audit (two readers, agreement on "serious" only, and on 2026-10-12 one reader). Neither measures agreement per KIND of error or plants pages in the same batch. -->

**Question.** #6420 calls a finding convergent when two AI readers of different families both make it, and waives a by-eye stop on that agreement. Do the two families agree above chance, per kind of error, and does each catch a planted one?

**Design.** `scripts/eval/cross-family-6203/README.md`, fixed before any reader ran. 33 pages, one per book, seed 6203: 5 from the #5826 gate's sample, 10 from the #5914 fortnightly spot check, 15 random live non-English books whose page serves English, and 3 planted controls (the next leaf's text under this leaf's image; one middle sentence cut from the English; one negation reversed in the English). 32 of the 33 pages were served to readers at the draw, 1 was in a hidden book. Readers get the frozen #6338 brief plus `KIND-ADDENDUM.md` (one of twelve kinds on every error), packets with no model name and no URL. $0.

**What ran.** The Opus reader only (`claude -p`, sealed folder, Read and Write only; 4 at a time; about 14 minutes).

**What did not run, and why.** The Gemini reader. It goes through the `agy` CLI, which is installed on the main box only. This job ran on another box, has no shell on main, and main refused new jobs (its Claude account was at 99% of its week). The same day the Gemini account was out of quota from 03:30 to 06:35 UTC and limited again soon after (#6420). So **no kappa was measured**. To finish: `scripts/eval/cross-family-6203/finish-gemini.sh scripts/eval/results/cross-family-6203/2026-10-12 <model>` on main; it rebuilds the run from the committed packets, reads, scores and packs.

**Result (one reader).**
- Opus read 33 of 33 pages. Every one of its 396 error entries carries a kind from the vocabulary.
- **Controls: 3 of 3 detected, each called serious, each with the right kind** (wrong leaf, omission, mistranslation).
- On the 30 natural pages Opus recorded a serious error on 18. By kind (pages; a page can carry several): misread 10, mistranslation 10, added gloss 5, illegible fill 4, confabulation 2, omission 2, layout 2, carry-over 1, other 1, recitation 0, show-through 0, wrong leaf 0. **This is not a rate of anything**: half the pages come from sets a model already reviewed, and it is one model's reading.

**What it does and does not show.** It shows the new vocabulary is usable by a reader (no entry without a kind) and that Opus, with this brief, finds the three planted kinds. It does not show reliability. The only cross-family figure remains #6338's alpha of -0.13, which is agreement at chance. Until the Gemini half lands, a finding two AI readers share is two readings, not a validated one.

**Replicated?** No. **Artifact:** `scripts/eval/results/cross-family-6203/2026-10-12/` (key, packets, Opus reviews, report). Images are fetched again by `restore`; 17 of 33 come back re-encoded by their host, which `restore.json` records.
