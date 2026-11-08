---
stage: translation
measure: [judged]
languages: [la, de]
scripts: [Latn]
canons: []
n_books: 69
n_pages: 480
router_evidence: "none — a seam/leak term on latin-cli-agy4 and german-cli-agy4, not page-acceptance k/n for rules.json; recorded in scripts/eval/estimator/router-table/2026-11-08-seam-pass-stage-8399.json and as evidence on both rows of scripts/lib/translation-routing-table.json (seam_pass 'edit-before')"
defect_rates: scripts/eval/results/seam-pass-8399/defect-rates.json
verdict: "On #8407's 120 four-page blocks (69 Latin/German books, 3.8 Flash low via agy), dropping the previous-page English (A0, PR #8410) left more broken joins at block starts: 44.9 per 100 against 40.7/39.0 for production (A/A2), a 5.1 rise against a 1.7 swing. Term consistency over 16 runs of 12 pages was no better and slightly worse under the Opus check (24/190 inconsistent against 18/193 and 19/184). The seam pass as built scores like #8407's eval copy C: lane 8.1 vs 9.7 per 100 (production mean 19.2), block starts 16.9 vs 18.6. On A0 it brings block starts down to 17.8. Almost all of that gain comes from editing the page before the block. With that page locked, block starts stay at 39.8. Every edit passed the span, growth and neighbour-gate guards. Usable rate was unchanged at about 50%, and translation-made leaks were 0 for every arm without previous English."
status: adopted
decision: "seam_pass 'edit-before' on latin-cli-agy4 and german-cli-agy4: the per-call reader runs claude-translate.mjs --seam-pass=1 --seam-edit-before=1, and cli-translate.mjs apply writes the repairs under their own run id (seam-pass-8399-<ts>). PR #8410 stays blocked: it fails the block-start clause on its own and the term-consistency clause with or without the pass."
superseded_by: null
issue: [8399, 8407, 8410, 8401, 7118]
feeds: route
---
## 2026-11-08 · Continuity: can we drop the previous page's English (A0), and does the seam pass work as a production stage? (#8399)
<!-- PRIOR ART: 2026-11-08-seam-markers-4-per-call-8399.md (#8407: the sample, the #7118 seam judge, the page judge and
the controls are reused unchanged; arm C there is the eval copy this stage productionises); seam-repair-6742/seam-repair.mjs
(writeRepairs, now with a runId option, is the write path); the neighbourGate is #8401's. Harness:
scripts/eval/seam-prevent-7118/seam-pass-8399.mjs. -->

**Answer for Derek.** Keep the previous-page English, and turn the seam pass on. Without the previous English (A0), more
joins break at block starts (44.9 per 100 against 39.9 for production, about three times the run-to-run swing), and names
and terms are rendered slightly less consistently, so #8410 stays blocked. The seam pass as built does what #8407's eval
copy did: it halves the broken joins (lane 19.2 → 8.1 per 100). It is now on for Latin and German.

### What ran
- **Sample:** #8407's 120 blocks (69 books; 95 Latin and 22 German blocks scored, 3 not scored for parse failures). Every
  arm was judged again together in one blind #7118 Opus seam-judge session, in both orders: 478 calls, 477 parsed. The
  judge floor (the same text twice) agreed 235/236. Planted defects were caught 227/230.
- **A0:** production per-call=4 with TRANSLATE_PREVIOUS_ENGLISH unset (PR #8410's `translate-core.mjs`), 126 agy calls.
  The prompt was checked to carry no "Previous page translation" block.
- **The stage, as built:** `claude-translate.mjs seam --out=DIR --seam-edit-before=1` (the code the lane runs, not the
  eval copy), over A0's reads (126 turns) and over Bb's reads (219 turns, the like-for-like check against C).
  "Locked" versions (A0L) use the same turns with every edit to the page before the block refused.
- **Term consistency:** 16 runs of 12 consecutive pages (16 books), read again under A, A2 and A0 (49–51 agy calls each).
  The mechanical count is distinct English renderings per recurring source name or term. 8 of the runs per arm were checked
  by Opus (24 calls).
- **Page judge:** route-judge-6740, Opus with the image open, on A0's pages and every page the stage changed (103 items,
  including 5 wrong-page controls, all rejected, and 6 bridge repeats of #8407's A verdicts, 0 flips).

### Results (per 100 joins; S = block start, T = inside a block, lane = 0.75 T + 0.25 S)

| arm | S | T | lane | translation leaks /480 | terms: renderings/term · Opus-inconsistent | usable |
|---|---|---|---|---|---|---|
| A (production) | 40.7 | 15.3 | 21.6 | 2 | 1.442 · 18/193 | 34/69 |
| A2 (production, run 2) | 39.0 | 9.3 | 16.7 | 2 | 1.417 · 19/184 | 35/69 |
| A0 (no previous English) | 44.9 | 11.9 | 20.1 | 0 | 1.450 · 24/190 | 32/68 |
| C (#8407 eval copy, on Bb) | 18.6 | 6.8 | 9.7 | 0 | — | (Bb 36/69) |
| Bb + built stage | 16.9 | 5.1 | 8.1 | 0 | — | 35/68 |
| A0 + built stage | 17.8 | 11.9 | 13.3 | 0 | as A0 | 32/68 |
| A0 + built stage, page before locked | 39.8 | 11.9 | 18.9 | 0 | as A0 | 32/68 |

By language (S, k/n): Latin A 34/95, A2 33/95, A0 38/95, A0+stage 17/95, locked 34/95, C 17/95, Bb+stage 16/95.
German A 13/22, A2 12/22, A0 14/22, A0+stage 3/22, locked 12/22, C 4/22, Bb+stage 3/22.

**Rule 1 (A0 decides #8410).** A0's S is 5.1 above mean(A, A2), and the A-vs-A2 swing is 1.7, so it fails. Term
consistency is not better, and it is a little worse on both counts: A0 is worse than both A and A2 in 4 of the 8 Opus-checked
runs and better in 2. One run (5 inconsistent terms against 1) carries most of the gap, so this is weak evidence, but the
rule asks for "not worse". **A0 + seam pass:** S recovers to 17.8. Terms do not change, because the pass only rewrites the
two edge spans. #8410 stays blocked.

**Rule 2 (the stage scores like C).** Bb+stage has lane 8.1 [4.9, 11.9] against C's 9.7 and production's 19.2. Paired
against C it is better on 5 S joins and worse on 3. It passes.

**#8407's caveat: the earlier page.** In the built stage on A0, 34 of the 42 turns it changed edit the stored English of the
page *before* the block, and that edit is the gain. With it refused, S is 39.8, the same as production. Each such edit passes
the same guards as an in-block one: it stays inside its span, the span grows no more than its set share, nothing outside the
spans changes, and the neighbourGate (#8401) runs on the result. Refusals over the A0 stage: 21 of 126 turns. 1 was refused
by the neighbourGate (a leak), 2 by span growth, 3 by touching more than 3 sentences, 5 returned no repair, and 10 by placement. In
production the edit is written by `cli-translate.mjs apply` against the stored text, and is skipped when the stored edges
differ from what the pass read (checked in a dry run: 9 of 11 refused as stale on an unstored eval read). So the flag is
`seam_pass: 'edit-before'`, not `true`.

**Not measured:** the stage on A itself, which is what the flag now runs on (A + previous English + pass). It helped A0 and
Bb by the same amount, so the same gain is expected on A.

### What the failing pages fail on (usable ≈ 50% on every arm; not chased here)
The page judge read each page with its image open. 35 of A's 69 pages fail (A2 34, A0 36). By main defect, A's failures are
16 translation, 10 OCR and 8 other (mostly a wrong-leaf I1 or mixed), plus 1 editorial. A0's are 14 translation, 13 OCR and 9 other. The single largest class is OCR **O6
misread rendered as fluent English** (42 defects on A's failing pages, 52 on A0's). After it come translation T9 quiet omission (17/16),
T7 fluent-over-garble (14/11) and T8 sense inverted (8/7). I1 wrong leaf appears 6–8 times. So about half the failures start in
the OCR and the translator smooths them over. A seam stage cannot fix those.

### Quota
agy: A0 reads 126 calls; stage on A0 126, on Bb 219; term-run reads A 51, A2 49, A0 49. That is 620 agy calls (Flash low, subscription). The
production cost of the flag is about one extra agy call per 4-page block (+25%). Claude (subscription `claude -p`, no
paid API): seam judge 478 Opus calls (list-price equivalent $45.52), term check 24 ($6.86), page judge 103 (not metered).
