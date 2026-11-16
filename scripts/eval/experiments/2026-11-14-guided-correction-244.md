---
stage: ocr
measure: [judged]
languages: [de]
scripts: [Latn]
canons: []
n_books: 23
n_pages: 35
verdict: "Giving Opus the audit's findings changes almost nothing: blind correction already fixes 15 of 17 checkable findings, guided fixes 16, and both refuse all 35 planted false reports (15 of them plausible modernised spellings). The loop's real gap is downstream: corrected pages keep the English made from the old transcription, and 88% of pages with a serious finding have it in the English."
status: undecided
decision: "Not adopted for Opus: no measurable gain. Corrected 2026-11-14 (#342): the pool order needs no decision. A limit stop stored on 2026-11-12 held the stale lane, not the order (#343, PR #344). The English-side repair for serious translation findings was tested the same day: 2026-11-14-english-repair-342.md."
feeds: [repair, route]
router_evidence: "none — a corrector prompt test (blind vs told the findings) on one route, plus read-only checks of the repair loop; no route was compared"
defect_rates: "none — scored with no judge, by string rules on the quoted misreads (score.py); fixed/still-there counts per arm are in scripts/eval/error-zoo/guided-correct/result-2026-11-14.json"
issue: [244]
---
PRIOR ART: 2026-10-31-correction-pass-paired-7818.md and 2026-10-28-correction-lane-production-accept-de-fr-7263.md measure BLIND correction (agy Flash-low on German and French); v3#199 and #8632 measure blind repairs of flagged pages. None gives the corrector the findings, and none follows a fix through to the English.

## 2026-11-14 · Detection to correction: does the corrector do better when told what the audit found, and does the fix reach the reader? (#244)

**Question.** Derek: test the loop from detection to correction, and find improvements that make individual books better, for example by using the detected errors. Every repair route so far (#7809 pilot, #8632, v3#199) corrects blind: the findings choose the page, the corrector never sees them.

**Part 1: guided correction.** The #7809 pilot set: 35 German print pages in 23 books, each with audit findings, corrected twice by Opus (`correct.mjs`, one page a call, fresh, from the same frozen draft, nothing written). A: blind. B: the page's findings as "reports that may be wrong; check each against the image", plus one planted false report in random position. 15 decoys are plausible modernisations (`heylet` reported as `heilet`), 20 visual non-words (`gewaltig` as `gcwaltig`). Scored with no model (`scripts/eval/error-zoo/guided-correct/score.py`, finding-check's rules).

| | blind (A) | guided (B) |
|---|---|---|
| checkable findings fixed | 15 of 17 | 16 of 17 |
| still there / changed otherwise | 1 / 1 | 0 / 1 |
| decoys applied | 0 of 35 | 0 of 35 |
| share of the text changed | 6.7% | 6.1% |

The two arms' texts differ by a median of 1.2% per page. 18 findings carry no quotable misread and cannot be checked without a judge.

**Part 2: does the fix reach the reader?** Read-only checks, 2026-11-14:

- **The transcription loop works.** v3#199 (2026-11-13): 1,255 measured-bad pages corrected; a Gemini judge reading blind against the image found 759 better, 440 the same, 15 confirmed worse (reverted). #8632: 30 / 6 / 2 by Opus, the 2 reverted.
- **The English is not redone.** Corrected pages are marked `translation_stale` and keep serving the English made from the old transcription (not withheld: `withhold-stale-translations` withheld 0 on its last run). Of the 36 kept #8632 pages, 36 still serve the old English two days later. The lane that re-translates them (`cli-translate-lane.mjs stale`, gex45 hourly) wrote 0 pages today. **Correction, same day (#342):** the reason first given here, that every pool was spent or held back for the finish-a-book queue under the #8482 order, was wrong. The pools read 85% to 100% left; the lane picked the fullest pool each hour and every call was refused by a limit stop stored on 2026-11-12, after Google had restarted that pool's week (#343, PR #344). The stop was moved aside at about 08:57 UTC. With the pools open the lane writes 1,000 to 3,000 pages a run. Its own log counts 821 books with stale pages on one route.
- **The repairs aim at the smaller problem.** On the weekly audit's random served pages (1,344), 421 have a serious finding: 20 in the transcription only, 212 in both, 160 in the English only, 68 other (wrong leaf etc.). So 372 of 421 (88%) carry a serious error in the English, and the repair queue takes transcription findings only. 7611 (2026-11-02) found only 17% of transcription errors leave the English wrong.

**Caveats.** One language, print, one corrector (Opus) near its ceiling: blind Opus already fixes almost every checkable finding, so this set cannot show a gain. A weaker corrector (agy Flash, the live route for most cells) misses more and might gain more from the findings; untested. No repeat of A was run, so the 1.2% A–B difference has no noise floor beside it.

**What it means.** Feeding findings to Opus is safe (no decoy taken) but not worth building for Opus. The changes that make books better are downstream. (1) Keep the stale lane running so corrected pages get new English; no pool-order decision is needed (see the correction above). (2) Repair the English directly where the audit found a serious translation error, the 88%. (3) Re-audit a sample after the English is redone, so the loop ends on what the reader sees.
