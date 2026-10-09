---
stage: translation
measure: judged
languages: []
scripts: []
canons: []
n_books: 95
n_pages: 95
verdict: "A restraint block has no measurable effect on judged invention (risk stratum 18.3% to 21.1%, p 0.80, floor 2.8 pp), though it cuts unmarked open ends 22.5% to 8.5%."
status: rejected
decision: "Restraint block left out of v16 by the preregistered rule (DECISIONS.md, 2026-09-30)"
superseded_by: null
issue: 5305
---
## 2026-09-30 — Does a "stop where the page stops" instruction cut invention? Restraint A/B on the audit's own pages (#5305)

**Headline: NO measurable effect on judged invention; the pre-registered rule says the block stays out of v16.**
Risk stratum (71 books, pages whose source ends mid-sentence or that the #5274 judge flagged for invention/garble):
invention 18.3% (v16) → 21.1% (v16 + restraint), McNemar 9 vs 7 discordant, p 0.80, against an A-vs-A noise
floor of 2.8 pp (v16 twice: 18.3% vs 21.1%, 10 vs 8 discordant). Guards all hold: omission 15.5 → 11.3%, fidelity
≥ 4 69.0 → 71.8%, control stratum (24) within the floor. **The instruction does change behaviour mechanically**:
unmarked open ends (source stops mid-sentence, translation closes it silently; `translation-bridging.mjs openEnd`)
22.5% → 8.5%, 11 vs 1 discordant, p 0.006, and `<meta>continues on next page</meta>` appears on 34% of risk pages.
**Why it did not move invention:** in all three arms the judge found page-end completion on only 3 defects each.
The page-break fix (#5103, `PAGE_BREAK_SCOPED`) and the hybrid continuity context, both on in every arm, already
removed most of the bridging the audit saw in OLDER served translations. What invention remains (18–22 defects per
arm) is mostly inside `<meta>`/`<note>`, often the opening `<meta>continues from previous page: …</meta>` that v15's
instruction 1 asks for, which supplies words from the previous page. Plus fluent prose over garbled OCR (the five
worst pages are the same corrupt-OCR pages, at the same score, in all three arms). Side effect: B emits
`<unclear>` 4.8× as often (6.9 vs 1.4 per risk page) without an omission penalty from the judge.
- **Design.** `PREREGISTRATION-translation-restraint.md` (written before the paid run; one amendment, pre-read).
  Arms A1 = v16 (v15 + note-scope sentence, #4767), A2 = A1 again, B = A1 + restraint block; production door
  (`buildTranslationPrompt`, previous-page continuity, adjacent OCR, `PAGE_BREAK_SCOPED`), production routing (270
  lite, 18 flash), Batch API. Judge: Claude Opus, the audit's rubric unchanged, 8 blinded packets; 12 repeat
  controls: 10/12 identical fidelity, 10/12 identical invention flag. English (modernisation) books out of scope.
  One page failed to translate in each v16 arm (95 of 96 scored).
- **measure = `judged`**, n = 95 books, exploratory grade. Five worst B pages: read from the judge's reasons, NOT by
  eye — all five are equally bad in A1/A2 (corrupt source OCR), so none is caused by the block.
- **Replicated?** No.
- **Spend.** Gemini Batch $0.34 (ledger line, ops `costs/spend-ledger.md`); judge on subscription (8 Opus
  subagents, ≈ 1.6M tokens).
- **Artifact.** `scripts/eval/results/translation-restraint-ab-2026-09-30/` (sample, arms.json with the exact
  prompt texts, arms.jsonl, verdicts/, packet-key.json, report.json). Harness `scripts/eval/translation-restraint-ab.mjs`.
  Detector (PR #5318) validation beside it. Next lever, not tested here: the continuity `<meta>` itself.
