---
stage: translation
measure: judged_vs_reference
languages: [bo]
scripts: [Tibt]
canons: [derge-kangyur]
n_books: 21
n_pages: 21
verdict: "Against 84000 on the Batch lane: Claude 4.71, flash 4.31, lite 4.02 mean fidelity; lite inverts on 9.5%; 190K pages cost ~$114 lite or ~$254 flash."
status: undecided
decision: "Kangyur retranslation spend PENDING Derek in DECISIONS.md (#4742); flash already the Tibetan engine for non-held books (PR #5094)"
superseded_by: null
issue: [4742, 4523]
---
## 2026-10-01 · Tibetan retranslation on the Batch lane: lite vs flash vs a Claude arm, on the CURRENT Yigdzin read, blind vs 84000 (#4742, #4523; costs the 189K-page decision)

**Question.** Derek, 2026-10-01: before the Kangyur English is bought, measure lite and flash on the lane the job would run on (the Batch API), on the OCR as it is now (Yigdzin with the #5264 leaf-break markers), and put a Claude translation beside them; cost it out per page from the meter, not the price list.

**Design.** The 09-25 sample (22 pages, one per Kangyur book, 84000 reference per matched folio; `refs-final.json` in the ops data dir). Arms: `gemini-3.1-flash-lite` and `gemini-3-flash-preview` as ONE file-based Batch job each (`tibetan-mt-ab/batch-arms.mjs`), production single-page prompt v13 with adjacent OCR, temperature 0, thinking off; `claude` = Claude Opus subagents on the subscription translating from the same OCR text, no reference shown, instructed to mark [unclear] rather than bridge (4 dispatches, 5–6 pages each). Judges: Opus and Sonnet `lean-worker` subagents, blind, 09-25 rubric (`JUDGE-PROMPT.md`), four 6-page chunks each, seed 4742. `build-judge-packet.mjs --engines … --src …` and `score.mjs --engines … --cost-order …` (this PR).

**Controls first.**
- Same-arm pairs (one engine twice under two labels, 4 pages): Opus 4/4 ties, Sonnet 4/4 ties.
- Positive control, built-in page (Toh 552 title leaf): FAILED as a calibration for the known reason (09-25 attempt 1: the concordance matched that leaf to the wrong text) — both judges scored the "reference" candidate 1/5 and said the reference is a different text, which is the right reading of a wrong reference. The exact-span control (`packet-control-v2`, 09-25 verdicts, Toh 9 F.392.b) passed 5/5 for both judges; it is reused, not re-run.
- Wrong references: Toh 543 p.307 (ch. 14 painting verses, not this page) and Toh 552 p.2 were judged against the source alone, as in 09-25.
- Batch vs the 09-25 realtime outputs, same prompt family, temperature 0: lite identical on 11/22 pages, flash on 5/22 — the Batch lane is not byte-reproducing the realtime arm, so it was judged afresh.

**Result (21 test pages, 2 judges; pooled over judge-pages).**

| arm | fidelity median | mean | invention | omission | inversion | 1st place (Opus / Sonnet) | $/page Batch (metered) | $/page realtime |
|---|---|---|---|---|---|---|---|---|
| Claude Opus (subscription) | 5 | 4.71 | 0% | 2.4% | 0% | 20 / 21 | n/a (subscription; API price not costed here) | — |
| gemini-3-flash-preview (Batch) | 4 (Opus 5, Sonnet 4) | 4.31 | 7.1% | 2.4% | 0% | 13 / 14 | **$0.00133** | $0.0027 |
| gemini-3.1-flash-lite (Batch) | 4 | 4.02 | 9.5% | 7.1% | **9.5%** | 6 / 10 | **$0.00060** | $0.0012 |

- Judge agreement: exact 63.5%, within one point 98.4%, mean |Δ| 0.38; shared first place on 21/21 pages.
- Where lite fails: two doctrinal inversions (Toh 44-45 p.510 reverses the merit comparison; Toh 44-45 p.504 confuses who does the not-perceiving), an invented Sanskrit title on the empowerment summary, an omitted list item. Flash: one invented name (Sudarśana → "Sagaradhvaja", three times, Stem Array p.537) is its only major flag. Claude: one judge flagged one omission (Gayāśīrṣa p.432, a practice left as [unclear]); no invention, no inversion.
- Versus 09-25 (realtime, no Claude candidate): flash 4.79 → 4.31, lite 4.43 → 4.02 pooled means. Two things moved at once — the Batch outputs differ on half the pages, and a stronger candidate on every page pulls the others' ranks down (fidelity is absolute in the rubric, but judges read it comparatively). Read the ARM ORDER as replicated (flash > lite, same gap), not the absolute level.
- Tokens: 2,563 input / 390 (lite) and 467 (flash) output per page; the adjacent-OCR context is most of the input. Batch jobs took 102 s (lite) and 204 s (flash) for 22 pages.

**Cost-out for the Tibetan pages that have the new read and no English (190,696 pages on 2026-10-01: 189,012 Yigdzin + 1,684 woodblock), at the metered Batch rate:** lite **≈ $114**, flash **≈ $254** (realtime ≈ $229 / $507). The 09-25 DECISIONS figure ($226 flash) was the list-price projection without the adjacent-OCR context; the measured number with it is $254.

**Limitation that matters.** The best arm and both judges are Claude models. The 84000 reference anchors the judge, the Sonnet judge is a different model from the Opus translator, and the same-arm floor is clean, but a same-family preference for house style cannot be excluded from this design. Before any decision rests on the Claude arm, judge the same packet with a non-Claude model (Gemini 3 Pro) or have five pages read by someone who reads Tibetan. Also: the Claude arm ran on the subscription (4 dispatches × ~85K tokens for 22 pages); a 190K-page run would be ~35K dispatches, which is not a subscription job — an API price is a separate question (claude-api skill, not quoted from memory here).

**Handoff rule (pre-registered 09-25, re-applied):** eligible = within 0.5 median fidelity of the best AND invention ≤ best + 5pp → only Claude (median 5, 0%); among the Gemini arms flash is within 0.5 of lite's… no: flash median 4 vs Claude 5 → not eligible; lite not eligible (invention 9.5% > 0 + 5pp). So the rule, as written, picks an arm we cannot run at scale yet. Between the two Gemini arms: flash, at 2.2× lite's price, removes the inversions (0 vs 2 pages of 21) and halves omission.

*Replicated?* The flash > lite order and lite's inversion risk replicate 09-25 (different judges' day, Batch lane, current OCR). The Claude arm is a single run, n = 21, same-family judges.
*Artifacts:* `results/tibetan-mt-ab-batch-2026-10-01/` (arms, key, verdicts, results.json, jobs.json); packet with the 84000 text in the ops repo `handoffs/data/2026-10-01-mtab-batch/` (CC BY-NC-ND, judge input only). Spend: Gemini $0.0425 (ledger); judges and the Claude arm on subscription (~1.3M subagent tokens).
