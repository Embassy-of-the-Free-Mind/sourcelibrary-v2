## 2026-10-03 · Does v16 (v15 + one sentence scoping the OMIT rule) keep v15's verified original-notes without losing interpretive notes? (#3825, #5698 step 1)

**Question.** v15 raised verified original-notes 66.7% → 96.3% but cut interpretive notes 1.27 → 0.81 per page, and the judge scored 8:1 against it (2026-09-12). Does one sentence restore the notes? The sentence: "This omit rule applies only to the quoted phrase in a `<note>original: "…"</note>`; interpretive and clarifying notes … are still wanted wherever a reader would need them."

**Design.**
- `translation-prompt-ab.mjs --tag v16 --b 16`, comparing v13 with v16.
- The same 320 pinned pages (one per book, 8 strata), with both arms re-run fresh.
- Flat on `gemini-3.1-flash-lite`, as in #4767.
- Rule: `PREREGISTRATION-translation-prompt-v15.md` plus Amendment 2 (`PREREGISTRATION-translation-prompt-v16-amendment.md`), committed before the run. Amendment 2 adds an interpretive-note floor of −15%, gates body length on non-looped pages, and drops headers from the judge brief.
- Blind judge: 6 Claude subagents over the v15 judge's 30 pages.
- Spend: **$1.264**.

**Result.**
- **Not established: do not flip.**
- Interpretive notes: 1.24 → 0.89 per page, **−28.7%**, paired Δ CI [−0.61, −0.13]. That fails the −15% floor. The sentence recovered about a fifth of v15's loss.
- Verified rate: 88.0% → 91.3%. The paired CI is not decisive (25 pages emit notes in both arms).
- Em-dash gate fired: +0.21 per page, in translator prose, mostly Hebrew, Arabic and CJK.
- Body length −13.9%. One v13 Tibetan runaway that stopped *under* the token cap accounts for all of it; without that page it is −0.3%.
- Judge 7:6, which passes. Four of v16's seven losses are dropped explanatory notes, on the same pages as in 2026-09-12.
- Hebrew 77.8% → 99.0% and Arabic 71.4% → 100% verified; neither CI excludes zero.
- Found on the way:
  - Under today's verifier (#4777, 2026-09-13), the 2026-09-12 v13 baseline is 76.3%, not 66.7%. Hebrew is 25%, not 8%.
  - v13's own output drifted between the two runs: 88% verified, invented tags 0.25 → 0.02 per page (likely the write-time sanitizer).

**Replicated?** Partly. The interpretive-note loss replicates the v15 finding (v15 −36.8%, v16 −28.7%). The verified-rate gain does not replicate at v15's size, because the v13 baseline moved.

**Artifact.**
- `scripts/eval/results/translation-prompt-v16-report-2026-10-03.{md,json}`
- `translation-prompt-v16-arms.jsonl`
- `translation-prompt-v16-judge-*`
- `scripts/maintenance/translation-prompt-v16-scope-omit.mjs`
